import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { diffBoards, diffLevels, parseLevelCsv, parseRankingCsv, RANKING_COLUMNS, validAcademicYear, validReleaseLabel } from "../../functions/lib/leaderboard-csv.js";

const HEADER = RANKING_COLUMNS.join(",");
const row = (overrides = {}) => {
  const base = {
    level: "5", semester: "1", cohort_key: "core", cohort_label: "Core cohort", board_kind: "semester",
    module_key: "", module_label: "", rank: "1", public_name: "Mariam A.", avatar_key: "mariam", avatar_family: "ink",
  };
  return RANKING_COLUMNS.map((name) => overrides[name] ?? base[name]).join(",");
};
const csv = (...rows) => [HEADER, ...rows].join("\n");

test("the committed fictional level-only example parses cleanly", async () => {
  const text = await readFile(new URL("../../data/ranking-upload.example.csv", import.meta.url), "utf8");
  const result = parseLevelCsv(text);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.rows.length, 30);
});

const levelCsv = (mutate = (rows) => rows) => {
  const rows = [];
  for (const level of [4, 5, 6]) {
    for (let rank = 1; rank <= 10; rank += 1) rows.push([String(level), String(rank), `Fictional Person ${"ABCDEFGHIJ"[rank - 1]}${level}`.replace(/\d/u, (d) => "XYZ"[Number(d) - 4])]);
  }
  return ["level,rank,public_name", ...mutate(rows).map((row) => row.join(","))].join("\n");
};

test("level-only parser accepts exactly 30 rows and preserves names", () => {
  const result = parseLevelCsv(levelCsv((rows) => {
    rows[0][2] = "  ZIAD  O'Brien-Smith ";
    rows[1][2] = "Ünal ÇELİK";
    rows[2][2] = "أحمد محمد";
    rows[3][2] = "Mary-Jane St. John";
    return rows;
  }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.rows[0], { level: 4, position: 1, public_name: "ZIAD O'Brien-Smith" });
  assert.equal(result.rows[1].public_name, "Ünal ÇELİK", "capitalization and accents are kept");
  assert.equal(result.rows[2].public_name, "أحمد محمد", "non-Latin scripts are accepted");
  assert.deepEqual([4, 5, 6].map((level) => result.rows.filter((row) => row.level === level).length), [10, 10, 10]);
});

test("level-only parser rejects malformed, incomplete, duplicated, and unsafe data", () => {
  const cases = {
    "29 rows": (rows) => rows.slice(1),
    "31 rows": (rows) => [...rows, ["4", "1", "Extra Person"]],
    "missing level 6": (rows) => rows.map((row) => row[0] === "6" ? ["5", row[1], `${row[2]} Q`] : row),
    "duplicate rank": (rows) => rows.map((row, index) => index === 1 ? ["4", "1", row[2]] : row),
    "rank 11": (rows) => rows.map((row, index) => index === 9 ? ["4", "11", row[2]] : row),
    "rank 0": (rows) => rows.map((row, index) => index === 0 ? ["4", "0", row[2]] : row),
    "level 7": (rows) => rows.map((row, index) => index === 0 ? ["7", "1", row[2]] : row),
    "duplicate name": (rows) => rows.map((row, index) => index === 1 ? [row[0], row[1], rows[0][2].toUpperCase()] : row),
    "markup": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "<script>alert(1)</script>"] : row),
    "formula": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "=HYPERLINK(1)"] : row),
    "leading minus": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "-Ahmed"] : row),
    "email": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "someone@example.com"] : row),
    "student id": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "Ahmed 2021123"] : row),
    "extra value": (rows) => rows.map((row, index) => index === 2 ? [...row, "95"] : row),
    "quoted comma": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "\"Smith"] : row),
    "control char": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "Name\u0007"] : row),
    "overlong name": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "A".repeat(81)] : row),
    "hangul filler blank": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "\u3164\u3164"] : row),
    "CGJ duplicate": (rows) => rows.map((row, index) => index === 1 ? [row[0], row[1], rows[0][2] + "\u034F"] : row),
    "variation selector": (rows) => rows.map((row, index) => index === 1 ? [row[0], row[1], "Name\uFE0F Bx"] : row),
    "cyrillic homoglyph": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "M\u0430riam Test"] : row),
    "fullwidth": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "\uFF2E\uFF41\uFF4D\uFF45"] : row),
    "zalgo": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "A" + "\u0301".repeat(10)] : row),
    "khmer invisible mark": (rows) => rows.map((row, index) => index === 1 ? [row[0], row[1], rows[0][2] + "\u17B4"] : row),
    "zero width space": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "Na\u200Bme"] : row),
    "rtl override": (rows) => rows.map((row, index) => index === 2 ? [row[0], row[1], "Name\u202Etset"] : row),
  };
  for (const [label, mutate] of Object.entries(cases)) {
    assert.equal(parseLevelCsv(levelCsv(mutate)).ok, false, label);
  }
  for (const header of ["level,rank,public_name,score", "level,rank,name", "rank,level,public_name", "level,rank,public_name,student_id"]) {
    assert.equal(parseLevelCsv(levelCsv().replace("level,rank,public_name", header)).ok, false, header);
  }
  assert.equal(parseLevelCsv("").ok, false);
  assert.equal(parseLevelCsv(`${levelCsv()}\n${"x".repeat(20000)}`).ok, false, "size limit");
});

test("level diff reports added, changed, and removed names by level and rank", () => {
  const live = [{ level: 4, position: 1, public_name: "A" }, { level: 4, position: 2, public_name: "B" }, { level: 5, position: 1, public_name: "C" }];
  const next = [{ level: 4, position: 1, public_name: "A" }, { level: 4, position: 2, public_name: "Z" }, { level: 6, position: 1, public_name: "D" }];
  const diff = diffLevels(live, next);
  assert.deepEqual(diff.levels.find((item) => item.level === 4).changes, [{ position: 2, change: "changed", before: "B", after: "Z" }]);
  assert.deepEqual(diff.levels.find((item) => item.level === 5).changes, [{ position: 1, change: "removed", before: "C", after: null }]);
  assert.deepEqual(diff.levels.find((item) => item.level === 6).changes, [{ position: 1, change: "added", before: null, after: "D" }]);
  assert.equal(validReleaseLabel("Week 5"), true);
  assert.equal(validReleaseLabel("<b>Week</b>"), false);
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
