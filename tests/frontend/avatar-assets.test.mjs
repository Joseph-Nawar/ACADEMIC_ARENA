import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

// Integration gate for character artwork (see docs/design/avatar-artwork-spec.md):
// every allowlisted character has all four delivery files with the expected
// format and size, and every allowlist (browser, BFF, newest SQL) agrees.
const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const listFrom = (source, pattern) => {
  const match = pattern.exec(source);
  assert.ok(match, `allowlist not found: ${pattern}`);
  return [...match[1].matchAll(/["']([a-z0-9]+)["']/gu)].map((item) => item[1]);
};

const appIds = listFrom(read("assets/app.js"), /const characterIds = \[([^\]]+)\]/u);
const appLabels = [.../const characterLabels = \[([^\]]+)\]/u.exec(read("assets/app.js"))[1].matchAll(/"([^"]+)"/gu)].map((item) => item[1]);
const browserIds = listFrom(read("assets/data-access.js"), /const CHARACTER_IDS = new Set\(\[([^\]]+)\]/u);
const serverIds = listFrom(read("functions/lib/validation.js"), /export const CHARACTER_IDS = new Set\(\[([^\]]+)\]/u);
const migrations = readdirSync(new URL("supabase/migrations/", root)).filter((name) => name.endsWith(".sql")).sort();
const newestSql = migrations.map((name) => read(`supabase/migrations/${name}`))
  .map((source) => /p_character_key not in \(([^)]+)\)/u.exec(source)).filter(Boolean).pop();
const sqlIds = [...newestSql[1].matchAll(/'([a-z0-9]+)'/gu)].map((item) => item[1]);

function pngInfo(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("latin1"), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), alpha: buffer[25] === 6 || buffer[25] === 4 };
}
function jpegInfo(buffer) {
  assert.equal(buffer.readUInt16BE(0), 0xffd8);
  for (let offset = 2; offset < buffer.length;) {
    const marker = buffer.readUInt16BE(offset);
    if (marker >= 0xffc0 && marker <= 0xffc2) return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  throw new Error("no JPEG frame header");
}

// Delivery formats: [suffix, format, check, max KB]. Comic full figures are
// rendered height-fitted, so existing art varies in size (317x495 to 668x829);
// new art targets 640x840 (docs/design/avatar-artwork-spec.md).
const FILES = [
  ["-ink.png", pngInfo, (info) => info.alpha && info.height >= 480 && info.height <= 900 &&
    info.width / info.height >= 0.6 && info.width / info.height <= 0.85, 800],
  ["-face.png", pngInfo, (info) => info.alpha && info.width === 256 && info.height === 256, 150],
  ["-3d.png", pngInfo, (info) => info.alpha && info.width === 418 && info.height === 418, 400],
  ["-3d-face.jpg", jpegInfo, (info) => info.width === 180 && info.height === 180, 40],
];

test("browser, BFF, and newest SQL character allowlists are identical", () => {
  assert.ok(appIds.length >= 9);
  assert.deepEqual([...browserIds].sort(), [...appIds].sort());
  assert.deepEqual([...serverIds].sort(), [...appIds].sort());
  assert.deepEqual([...sqlIds].sort(), [...appIds].sort());
  assert.equal(appLabels.length, appIds.length, "each character has a mood label");
  assert.equal(new Set(appIds).size, appIds.length);
});

// Latest definition of each of the four table constraints that allowlist characters:
// the inline check in the creating migration, or a later named re-definition.
const CONSTRAINTS = [
  ["public.student_avatar_configs", "character_key", "student_avatar_configs_character_key_check"],
  ["app_private.campus_wins_submissions", "approved_avatar_key", "campus_wins_submissions_approved_avatar_key_check"],
  ["public.published_leaderboard_rows", "avatar_key", "published_leaderboard_rows_avatar_key_check"],
  ["public.campus_wins_public", "avatar_key", "campus_wins_public_avatar_key_check"],
];
function latestConstraintKeys(table, column, name) {
  let latest = null;
  for (const file of migrations) {
    const source = read(`supabase/migrations/${file}`);
    const created = new RegExp(`create table ${table.replace(".", "\\.")} \\(([\\s\\S]*?)\\n\\);`, "u").exec(source);
    const inline = created && new RegExp(`${column} in \\(([^)]+)\\)`, "u").exec(created[1]);
    if (inline) latest = inline[1];
    for (const match of source.matchAll(new RegExp(`constraint ${name} check \\(\\w+ in \\(([^)]+)\\)`, "gu"))) latest = match[1];
  }
  assert.ok(latest, `no definition found for ${name}`);
  return [...latest.matchAll(/'([a-z0-9]+)'/gu)].map((item) => item[1]).sort();
}

test("all four character check constraints allow exactly the allowlisted keys", () => {
  for (const [table, column, name] of CONSTRAINTS) {
    assert.deepEqual(latestConstraintKeys(table, column, name), [...appIds].sort(), `${name} is out of date`);
  }
});

test("the legacy CSV importer reuses the BFF allowlist instead of its own copy", () => {
  const source = read("functions/lib/leaderboard-csv.js");
  assert.match(source, /import \{ CHARACTER_IDS \} from "\.\/validation\.js"/u);
  assert.doesNotMatch(source, /"habiba2"/u);
});

test("every allowlisted character ships all four files in the delivery format", () => {
  for (const id of appIds) {
    for (const [suffix, parse, valid, maxKb] of FILES) {
      const path = new URL(`assets/characters/${id}${suffix}`, root);
      const buffer = readFileSync(path);
      const info = parse(buffer);
      assert.ok(valid(info), `${id}${suffix} has the wrong format or size: ${JSON.stringify(info)}`);
      assert.ok(statSync(path).size <= maxKb * 1024, `${id}${suffix} is larger than ${maxKb} KB`);
    }
  }
});

test("character labels describe a mood, never an identity", () => {
  const identity = /\b(male|female|man|woman|boy|girl|hijab|muslim|christian|black|white|arab|african|asian|religio|ethnic|skin)\b/iu;
  for (const label of appLabels) assert.doesNotMatch(label, identity);
});
