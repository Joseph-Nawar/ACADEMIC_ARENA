// Release A: the studio says "public" when the database projection returns a
// character; the BFF and browser only draw it when every field passes their
// own allowlists. Keep all three lists identical so the two never disagree.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CHARACTER_BADGES, CHARACTER_FAMILIES, CHARACTER_IDS, CHARACTER_TONES } from "../../functions/lib/validation.js";

const migration = readFileSync(new URL("../../supabase/migrations/202611190001_v12_student_accounts_and_avatar_links.sql", import.meta.url), "utf8");
const browser = readFileSync(new URL("../../assets/data-access.js", import.meta.url), "utf8");
const saveFunction = migration.slice(migration.indexOf("create function public.save_own_avatar_preferences"));
const sqlList = (column) => {
  const match = new RegExp(`p_${column} not in \\(([^)]*)\\)`, "u").exec(saveFunction);
  return [...match[1].matchAll(/'([^']*)'/gu)].map((item) => item[1]).sort();
};
const jsList = (name) => {
  const match = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`, "u").exec(browser);
  return [...match[1].matchAll(/"([^"]*)"/gu)].map((item) => item[1]).sort();
};

test("character allowlists match across the database, the BFF and the browser", () => {
  for (const [column, bff, page] of [
    ["character_key", CHARACTER_IDS, "CHARACTER_IDS"],
    ["family", CHARACTER_FAMILIES, "AVATAR_STYLES"],
    ["tone", CHARACTER_TONES, "TONES"],
    ["badge", CHARACTER_BADGES, "BADGES"],
  ]) {
    assert.deepEqual([...bff].sort(), sqlList(column), `${column}: BFF matches the database`);
    assert.deepEqual(jsList(page), sqlList(column), `${column}: browser matches the database`);
  }
});
