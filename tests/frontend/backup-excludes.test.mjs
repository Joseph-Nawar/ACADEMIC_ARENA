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
    // Statements inside function bodies ($$ … $$) are not seeds; only top-level ones are.
    const topLevel = readFileSync(new URL(name, directory), "utf8").replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/gu, "$$$$");
    for (const match of topLevel.matchAll(/^\s*(?:insert\s+into|copy)\s+"?([a-z_]+)"?\."?([a-z_]+)"?/gimu)) seeded.add(`${match[1]}.${match[2]}`.toLowerCase());
  }
  assert.ok(seeded.size >= 3);
  for (const table of seeded) assert.match(script, new RegExp(`-x ${table.replace(".", "\\.")}(\\s|$)`, "u"), `${table} must be excluded`);
});
