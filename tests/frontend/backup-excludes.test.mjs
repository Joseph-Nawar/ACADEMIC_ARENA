import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// A table that a migration seeds with rows must be excluded from the data
// export, or a restore onto a freshly migrated project collides with the
// migration's own rows (found in the V1.2 staging drill).
test("every migration-seeded table is excluded from encrypted data exports", () => {
  const script = readFileSync(new URL("../../scripts/db-backup.sh", import.meta.url), "utf8");
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  const seeded = new Set();
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql"))) {
    for (const match of readFileSync(new URL(name, directory), "utf8").matchAll(/^insert into ([a-z_]+\.[a-z_]+)/gmu)) seeded.add(match[1]);
  }
  assert.ok(seeded.size >= 3);
  for (const table of seeded) assert.match(script, new RegExp(`-x ${table.replace(".", "\\.")}(\\s|$)`, "u"), `${table} must be excluded`);
});
