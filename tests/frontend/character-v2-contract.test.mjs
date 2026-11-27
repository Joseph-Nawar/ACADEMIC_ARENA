// Contract: the database allowlist for Character V2 (fields, values, item
// collections, hat/hair traits, rank rules) is exactly what the trusted
// catalogue in assets/avatar-v2/catalog.js says. The studio, the BFF and the
// database write boundary therefore accept the same configs.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { extract, generate, loadCatalog } from "../../scripts/character-v2-sql.mjs";

const migrations = join(import.meta.dirname, "../../supabase/migrations");
const withBlock = readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => ({ name, block: extract(readFileSync(join(migrations, name), "utf8")) }))
  .filter((entry) => entry.block);

test("the newest migration's catalogue block matches catalog.js exactly", () => {
  assert.ok(withBlock.length >= 1, "a migration carries the generated catalogue");
  const newest = withBlock.at(-1);
  assert.equal(newest.block, generate(), `${newest.name} is out of date: run node scripts/character-v2-sql.mjs --write supabase/migrations/${newest.name} (only if it is not merged yet; otherwise add a new migration)`);
});

test("every reward item belongs to a non-free collection and identity options stay free", () => {
  const catalog = loadCatalog();
  const sql = generate(catalog);
  for (const field of ["skin", "face", "build", "hair", "hairColor", "eyes", "eyeColor", "brows", "nose", "mouth", "facialHair", "details"]) {
    for (const value of catalog.fields[field].values) assert.match(sql, new RegExp(`\\('${field}', '${value}', 'essentials'`), `${field}.${value} is free`);
  }
  for (const slot of ["glasses", "hearing", "mobility"]) {
    for (const value of catalog.fields[slot].values) assert.match(sql, new RegExp(`\\('${slot}', '${value}', 'essentials'`), `assistive ${slot}.${value} is free`);
  }
  for (const value of ["wrap", "sport", "draped", "khimar", "turban", "kufi"]) {
    assert.match(sql, new RegExp(`\\('headwear', '${value}', 'essentials'`), `head covering ${value} is free`);
  }
});

test("rank rules in SQL match collectionsForPosition", () => {
  const catalog = loadCatalog();
  const rules = [...generate(catalog).matchAll(/\((\d+), '([a-z]+)'\)/g)].map(([, max, name]) => [Number(max), name]);
  for (let position = 1; position <= 12; position += 1) {
    const fromSql = rules.filter(([max]) => position <= max).map(([, name]) => name).sort();
    assert.deepEqual(fromSql, [...catalog.collectionsForPosition(position)].sort(), `position ${position}`);
  }
});

test("the SQL validator mirrors the catalogue's only compatibility rule", () => {
  const catalog = loadCatalog();
  const sql = generate(catalog);
  for (const [key, item] of Object.entries(catalog.items)) {
    if (item.slot !== "headwear") continue;
    const value = key.split(".")[1];
    assert.match(sql, new RegExp(`\\('headwear', '${value}', '[a-z]+', ${item.fit ? `'${item.fit}'` : "null"}\\)`), `headwear ${value} fit`);
  }
  for (const [value, style] of Object.entries(catalog.options.hairstyles)) {
    assert.match(sql, new RegExp(`\\('hair', '${value}', 'essentials', ${style.volume === "big" ? "'big'" : "null"}\\)`), `hair ${value} volume`);
  }
});
