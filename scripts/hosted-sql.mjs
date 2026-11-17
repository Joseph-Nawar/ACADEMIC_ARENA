// Apply committed migrations / run read-only checks on a hosted Supabase
// project over the HTTPS Management API. For networks that block the Postgres
// protocol (where `supabase db push` cannot connect). Uses the CLI login from
// `npx supabase login` (macOS keychain or SUPABASE_ACCESS_TOKEN); the token is
// kept in memory and never printed or passed in argv. Never applies seed.sql.
//
//   node scripts/hosted-sql.mjs <project-ref> migrate [--dry-run]
//   node scripts/hosted-sql.mjs <project-ref> query "<sql>"
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const [ref, command, arg] = process.argv.slice(2);
if (!/^[a-z0-9]{20}$/u.test(ref || "") || !["migrate", "query"].includes(command)) {
  console.error("usage: hosted-sql.mjs <project-ref> migrate [--dry-run] | query \"<sql>\"");
  process.exit(2);
}

function accessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  let value = execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-w"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (value.startsWith("go-keyring-base64:")) value = Buffer.from(value.slice(18), "base64").toString("utf8").trim();
  if (!/^sbp_[A-Za-z0-9_]{20,}$/u.test(value)) throw new Error("Supabase CLI login not found; run npx supabase login.");
  return value;
}
const token = accessToken();

async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Management API ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : [];
}

if (command === "query") {
  console.log(JSON.stringify(await sql(arg), null, 1));
  process.exit(0);
}

const dryRun = arg === "--dry-run";
await sql(`create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
const applied = new Set((await sql("select version from supabase_migrations.schema_migrations")).map((row) => row.version));
const files = readdirSync(path.join(root, "supabase/migrations")).filter((name) => /^\d{12,14}_[a-z0-9_]+\.sql$/u.test(name)).sort();
for (const file of files) {
  const [version, ...nameParts] = file.replace(/\.sql$/u, "").split("_");
  if (applied.has(version)) {
    console.log(`already applied  ${file}`);
    continue;
  }
  if (dryRun) {
    console.log(`would apply      ${file}`);
    continue;
  }
  const body = readFileSync(path.join(root, "supabase/migrations", file), "utf8");
  const tag = `aa_mig_${Math.random().toString(36).slice(2)}`;
  // One request = one implicit transaction: the migration and its history row commit together.
  await sql(`${body}\n;\ninsert into supabase_migrations.schema_migrations (version, name, statements) values ($${tag}$${version}$${tag}$, $${tag}$${nameParts.join("_")}$${tag}$, array[]::text[]);`);
  console.log(`applied          ${file}`);
}
