#!/usr/bin/env node
// Generates the database allowlist for Character V2 from the one trusted
// catalogue (assets/avatar-v2/catalog.js), so the studio, the BFF and the
// database write boundary cannot disagree.
//
//   node scripts/character-v2-sql.mjs            print the generated SQL
//   node scripts/character-v2-sql.mjs --write F  replace the generated block in migration F
//
// tests/frontend/character-v2-contract.test.mjs fails if a migration's block
// differs from what this prints. A later catalogue change goes in a NEW
// migration (migrations are append-only); the contract test reads the newest one.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BEGIN = "-- BEGIN GENERATED character-v2 catalogue (scripts/character-v2-sql.mjs)";
export const END = "-- END GENERATED character-v2 catalogue";

export function loadCatalog() {
  const sandbox = {};
  vm.runInNewContext(readFileSync(join(root, "assets/avatar-v2/catalog.js"), "utf8"), { globalThis: sandbox, TextEncoder });
  return sandbox.AcademicArenaAvatarCatalog;
}

const literal = (value) => (value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`);

export function generate(catalog = loadCatalog()) {
  const lines = [BEGIN];
  const collections = Object.entries(catalog.collections).sort((a, b) => a[1].order - b[1].order);
  lines.push("insert into app_private.cosmetic_collections (collection_key, free, earnable, label, sort_order) values");
  lines.push(collections.map(([key, value]) =>
    `  (${literal(key)}, ${key === "essentials"}, ${key !== "essentials" && value.inactive !== true}, ${literal(value.label)}, ${value.order})`).join(",\n") + ";");

  const fieldRows = Object.entries(catalog.fields).map(([field, spec], index) => {
    const fallback = catalog.DEFAULT_CONFIG[field];
    return `  (${literal(field)}, ${literal(spec.kind)}, ${spec.max ?? "null"}, ${literal(JSON.stringify(fallback))}::jsonb, ${index + 1})`;
  });
  lines.push("insert into app_private.character_v2_fields (field, kind, max_items, default_value, sort_order) values");
  lines.push(fieldRows.join(",\n") + ";");

  const valueRows = [];
  for (const [field, spec] of Object.entries(catalog.fields)) {
    for (const value of spec.values) {
      let collection = "essentials";
      let trait = null;
      if (spec.kind === "item") {
        const item = catalog.items[catalog.itemKey(field, value)];
        collection = item.collection;
        trait = item.fit ?? null;
      } else if (field === "hair") {
        trait = catalog.options.hairstyles[value].volume === "big" ? "big" : null;
      }
      valueRows.push(`  (${literal(field)}, ${literal(value)}, ${literal(collection)}, ${literal(trait)})`);
    }
  }
  lines.push("insert into app_private.character_v2_values (field, value, collection_key, trait) values");
  lines.push(valueRows.join(",\n") + ";");

  lines.push("insert into app_private.rank_reward_rules (max_position, collection_key) values");
  // Each collection with the widest position that earns it (Top 10 → elite, ...).
  const widest = new Map();
  for (const rule of catalog.rankRewards) {
    for (const name of rule.collections) widest.set(name, Math.max(widest.get(name) ?? 0, rule.maxPosition));
  }
  lines.push([...widest].map(([name, max]) => `  (${max}, ${literal(name)})`).join(",\n") + ";");
  lines.push(END);
  return lines.join("\n");
}

export function extract(sql) {
  const start = sql.indexOf(BEGIN);
  const end = sql.indexOf(END);
  return start >= 0 && end > start ? sql.slice(start, end + END.length) : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] === "--write" ? process.argv[3] : null;
  const generated = generate();
  if (!target) {
    process.stdout.write(generated + "\n");
  } else {
    const sql = readFileSync(target, "utf8");
    const current = extract(sql);
    if (!current) throw new Error(`No generated block in ${target}`);
    writeFileSync(target, sql.replace(current, generated));
    console.log(`Updated the generated catalogue block in ${target}`);
  }
}
