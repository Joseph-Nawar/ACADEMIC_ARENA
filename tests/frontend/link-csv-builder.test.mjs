// Offline link-file builder: joins only on verified identifiers, rejects
// duplicates and ambiguity, reports by position, and never prints private
// values. Fictional data only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildLinks, linksToCsv, parseCsv } from "../../scripts/lib/link-csv-builder.mjs";

const roster = [
  "roster_ref,email,username,eligible",
  "FX10001,alpha.fx@uni.example,fx-wave-01,yes",
  "FX10002,bravo.fx@uni.example,fx-wave-02,yes",
  "FX10003,charlie.fx@uni.example,fx-wave-03,no",
  "FX10004,delta.fx@uni.example,fx-wave-04,yes",
  "FX10005,echo.fx@uni.example,fx-wave-05,yes",
].join("\n");

const source = [
  "Level,Rank,Student Name,Student ID,University Email,Quizzes",
  "4,1,\"Farouk, Laila\",FX10001,Alpha.FX@uni.example,5",
  "4,2,Karim Fathy,FX 10002,bravo.fx@uni.example,5",
  "4,3,Nadia Wahba,FX10003,charlie.fx@uni.example,4",
  "4,4,Omar Twin,FX99999,nobody.fx@uni.example,4",
  "5,1,Laila Farouk,FX10004,delta.fx@uni.example,5",
  "5,2,Rana Adel,FX10004,delta.fx@uni.example,5",
  "6,1,Hany Saad,,,5",
  "6,11,Below Ten,FX10005,echo.fx@uni.example,1",
].join("\n");

const columns = { level: "Level", rank: "Rank", key: "Student ID" };

test("joins only on the verified identifier and reports every other row by position", () => {
  const result = buildLinks({ sourceText: source, rosterText: roster, key: "roster-ref", columns });
  assert.equal(result.ok, true);
  assert.deepEqual(result.links, [
    { level: 4, rank: 1, username: "fx-wave-01" },
    { level: 4, rank: 2, username: "fx-wave-02" }, // spaces in the reference are ignored
  ]);
  const text = result.problems.join("\n");
  assert.match(text, /Level 4 rank 3: roster row 4 is not eligible/);
  assert.match(text, /Level 4 rank 4: no roster match/);
  assert.match(text, /Level 5 rank 1: the same student identifier appears at 2 positions/);
  assert.match(text, /Level 5 rank 2: the same student identifier appears at 2 positions/);
  assert.match(text, /Level 6 rank 1: no reference in the source/);
  assert.equal(result.summary.outsideTop10, 1, "ranks below 10 are never linked");
  assert.doesNotMatch(text, /FX1|uni\.example|fx-wave|Farouk|Fathy|Nadia|Omar/u, "problems never contain identifiers, names or usernames");
});

test("email join is case-insensitive; names are never a join key", () => {
  const result = buildLinks({ sourceText: source, rosterText: roster, key: "email", columns: { ...columns, key: "University Email" } });
  assert.deepEqual(result.links.map((link) => link.username), ["fx-wave-01", "fx-wave-02"]);
  const byName = buildLinks({ sourceText: source, rosterText: roster, key: "name", columns });
  assert.equal(byName.ok, false, "there is no name key");
});

test("ambiguous roster identifiers and duplicate usernames are rejected", () => {
  const ambiguous = `${roster}\nFX10001,alpha.second@uni.example,fx-wave-09,yes`;
  const result = buildLinks({ sourceText: source, rosterText: ambiguous, key: "roster-ref", columns });
  assert.match(result.problems.join("\n"), /Level 4 rank 1: matches 2 roster rows \(lines 2, 7\); not linked/);
  assert.ok(!result.links.some((link) => link.rank === 1 && link.level === 4));
  const duplicateUser = buildLinks({ sourceText: source, rosterText: `${roster}\nFX20000,zulu.fx@uni.example,fx-wave-01,yes`, key: "roster-ref", columns });
  assert.equal(duplicateUser.ok, false);
  assert.match(duplicateUser.fatal.join("\n"), /username also on line 2/);
});

test("a duplicated position in the source links neither row", () => {
  const twice = `${source}\n4,1,Someone Else,FX10005,echo.fx@uni.example,5`;
  const result = buildLinks({ sourceText: twice, rosterText: roster, key: "roster-ref", columns });
  assert.match(result.problems.join("\n"), /Level 4 rank 1: appears twice in the source/);
  assert.ok(!result.links.some((link) => link.level === 4 && link.rank === 1));
});

test("optional published cross-check: a different version or name blocks the row", () => {
  const published = ["level,rank,public_name", "4,1,Laila Farouk", "4,2,Karim F.", "4,5,Missing Person"].join("\n");
  const result = buildLinks({ sourceText: source, rosterText: roster, key: "roster-ref",
    columns: { ...columns, name: "Student Name" }, publishedText: published });
  const text = result.problems.join("\n");
  assert.match(text, /Level 4 rank 5: published, but missing from the source/);
  assert.match(text, /Level 4 rank 3: not on the published board/);
  // "Farouk, Laila" vs "Laila Farouk" and "Karim Fathy" vs "Karim F." differ.
  assert.match(text, /Level 4 rank 1: source name differs/);
  assert.equal(result.links.length, 0);
  const allowed = buildLinks({ sourceText: source, rosterText: roster, key: "roster-ref",
    columns: { ...columns, name: "Student Name" }, publishedText: published, allowNameMismatch: true });
  assert.equal(allowed.links.length, 2);
  assert.match(allowed.problems.join("\n"), /included because of --allow-name-mismatch/);
});

test("current approved links are kept; disagreements keep the current link", () => {
  const current = ["level,rank,username", "6,2,fx-wave-05", "4,1,fx-wave-04"].join("\n");
  const result = buildLinks({ sourceText: source, rosterText: roster, key: "roster-ref", columns, currentText: current });
  assert.deepEqual(result.links, [
    { level: 4, rank: 1, username: "fx-wave-04" },
    { level: 4, rank: 2, username: "fx-wave-02" },
    { level: 6, rank: 2, username: "fx-wave-05" },
  ]);
  assert.match(result.problems.join("\n"), /Level 4 rank 1: the current approved link disagrees/);
  assert.equal(result.summary.conflictsWithCurrent, 1);
});

test("quoted CSV fields parse like a spreadsheet export", () => {
  const parsed = parseCsv("a,b\r\n\"x, y\",\"he said \"\"hi\"\"\"\r\n");
  assert.deepEqual(parsed.rows, [["x, y", "he said \"hi\""]]);
  assert.equal(linksToCsv([{ level: 4, rank: 1, username: "fx-wave-01" }]), "level,rank,username\n4,1,fx-wave-01\n");
});

test("CLI: private output outside the repo, mode 600, never overwritten, nothing private printed", () => {
  const dir = mkdtempSync(join(tmpdir(), "aa-links-"));
  try {
    writeFileSync(join(dir, "source.csv"), source);
    writeFileSync(join(dir, "roster.csv"), roster);
    const args = ["scripts/build-link-csv.mjs", "--source", join(dir, "source.csv"), "--roster", join(dir, "roster.csv"),
      "--key", "roster-ref", "--source-level-column", "Level", "--source-rank-column", "Rank", "--source-key-column", "Student ID"];
    const run = spawnSync(process.execPath, [...args, "--out", join(dir, "links.csv")], { encoding: "utf8" });
    assert.equal(run.status, 1, "problems exist, so the exit code is 1");
    assert.equal(readFileSync(join(dir, "links.csv"), "utf8"), "level,rank,username\n4,1,fx-wave-01\n4,2,fx-wave-02\n");
    assert.equal(statSync(join(dir, "links.csv")).mode & 0o777, 0o600);
    assert.doesNotMatch(run.stdout + run.stderr, /FX1|uni\.example|fx-wave|Farouk|Fathy|Nadia|Omar|Laila/u);
    assert.match(run.stdout, /Summary: linked 2, no roster match 1/);
    const again = spawnSync(process.execPath, [...args, "--out", join(dir, "links.csv")], { encoding: "utf8" });
    assert.equal(again.status, 2);
    assert.match(again.stderr, /--out must name a new file/);
    const inside = spawnSync(process.execPath, [...args, "--out", "data/links.csv"], { encoding: "utf8" });
    assert.equal(inside.status, 2);
    assert.match(inside.stderr, /--out must be outside the repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
