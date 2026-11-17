import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { diffBoards, parseRankingCsv, RANKING_COLUMNS, validAcademicYear } from "../../functions/lib/leaderboard-csv.js";

const HEADER = RANKING_COLUMNS.join(",");
const row = (overrides = {}) => {
  const base = {
    level: "5", semester: "1", cohort_key: "core", cohort_label: "Core cohort", board_kind: "semester",
    module_key: "", module_label: "", rank: "1", public_name: "Mariam A.", avatar_key: "mariam", avatar_family: "ink",
  };
  return RANKING_COLUMNS.map((name) => overrides[name] ?? base[name]).join(",");
};
const csv = (...rows) => [HEADER, ...rows].join("\n");

test("the committed fictional example parses cleanly", async () => {
  const text = await readFile(new URL("../../data/ranking-upload.example.csv", import.meta.url), "utf8");
  const result = parseRankingCsv(text);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.rows.length >= 10);
});

test("valid rows are normalized into the database shape", () => {
  const result = parseRankingCsv(csv(
    row(),
    row({ rank: "2", public_name: "  Omar   B. ", avatar_key: "omar", avatar_family: "cartoon3d" }),
    row({ board_kind: "module", module_key: "cm2005", module_label: "Object-oriented programming", public_name: "Zein K." }),
  ));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.boardCount, 2);
  assert.deepEqual(result.rows[1], {
    level: 5, semester: 1, cohort_key: "core", cohort_label: "Core cohort", board_kind: "semester",
    module_key: null, module_label: null, position: 2, public_name: "Omar B.", avatar_key: "omar", avatar_family: "cartoon3d",
  });
});

test("unexpected or sensitive columns are rejected", () => {
  for (const header of [
    `${HEADER},grade`, `${HEADER},student_id`, HEADER.replace("public_name", "email"),
    HEADER.split(",").reverse().join(","), HEADER.replace(",avatar_family", ""),
  ]) {
    const result = parseRankingCsv(`${header}\n${row()}`);
    assert.equal(result.ok, false, header);
  }
});

test("malformed and tampered values are rejected without partial results", () => {
  const cases = [
    row({ level: "7" }), row({ semester: "3" }), row({ rank: "0" }), row({ rank: "11" }), row({ rank: "1.5" }),
    row({ public_name: "<img src=x onerror=alert(1)>" }), row({ public_name: "=HYPERLINK(\"x\")" }),
    row({ public_name: "Robert'); DROP TABLE" }), row({ public_name: "+44 7700" }), row({ public_name: "Name\u0007" }),
    row({ avatar_key: "admin" }), row({ avatar_family: "photo" }), row({ cohort_key: "Core Cohort" }),
    row({ board_kind: "module" }), row({ module_key: "cm1" }), row({ cohort_label: "<b>x</b>" }),
    `${row()},extra`, row({ public_name: "\"Quoted \"inner\" name\"" }),
  ];
  for (const bad of cases) {
    const result = parseRankingCsv(csv(row({ rank: "2", public_name: "Valid Person" }), bad));
    assert.equal(result.ok, false, bad);
    assert.equal(result.rows, undefined);
  }
});

test("duplicate ranks, duplicate students, gaps, and label conflicts are rejected", () => {
  assert.equal(parseRankingCsv(csv(row(), row({ public_name: "Other Person" }))).ok, false, "duplicate rank");
  assert.equal(parseRankingCsv(csv(row(), row({ rank: "2", public_name: "mariam a." }))).ok, false, "duplicate student");
  assert.equal(parseRankingCsv(csv(row(), row({ rank: "3", public_name: "Other Person" }))).ok, false, "gap");
  assert.equal(parseRankingCsv(csv(row(), row({ rank: "2", public_name: "Other Person", cohort_label: "Different" }))).ok, false,
    "conflicting cohort label");
  const eleven = Array.from({ length: 11 }, (_, index) => row({ rank: String(index + 1), public_name: `Person ${"abcdefghijk"[index]}` }));
  assert.equal(parseRankingCsv(csv(...eleven)).ok, false, "more than 10 per board");
});

test("size and row limits are enforced before parsing work", () => {
  assert.equal(parseRankingCsv("").ok, false);
  assert.equal(parseRankingCsv(HEADER).ok, false);
  assert.equal(parseRankingCsv(`${HEADER}\n${"a".repeat(256 * 1024)}`).ok, false);
  const many = Array.from({ length: 2001 }, () => row());
  assert.match(parseRankingCsv(csv(...many)).errors[0].message, /more than 2000/u);
});

test("Windows line endings, BOM, and quoted simple values are accepted", () => {
  const text = "﻿" + [HEADER, row({ public_name: "\"Nour E.\"" })].join("\r\n") + "\r\n";
  const result = parseRankingCsv(text);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.rows[0].public_name, "Nour E.");
});

test("academic year format is strict", () => {
  assert.equal(validAcademicYear("2026-27"), true);
  for (const value of ["2026-28", "2026", "26-27", "2026-27x", null]) assert.equal(validAcademicYear(value), false, String(value));
});

test("diff reports added, changed, removed, and unchanged boards", () => {
  const base = { level: 5, semester: 1, cohort_key: "core", board_kind: "semester", module_key: null, avatar_key: "omar", avatar_family: "ink" };
  const live = [
    { ...base, position: 1, public_name: "A" },
    { ...base, board_kind: "module", module_key: "m1", position: 1, public_name: "B" },
    { ...base, level: 6, position: 1, public_name: "C" },
  ];
  const next = [
    { ...base, position: 1, public_name: "Z" },
    { ...base, level: 6, position: 1, public_name: "C" },
    { ...base, level: 4, position: 1, public_name: "D" },
  ];
  const diff = diffBoards(live, next);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.unchanged, 1);
});
