// Local-only interactive preview: production build + Pages Functions + local
// Supabase, with fictional accounts for manual QA. Loopback only; never hosted.
// Usage: npm run supabase:start && node scripts/local-live-preview.mjs <credentials-output-file>
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = process.argv[2];
if (!output || path.resolve(output).startsWith(root)) {
  console.error("Pass a credentials file path outside the repository.");
  process.exit(2);
}
const statusText = execFileSync("npx", ["--no-install", "supabase", "status", "--env", "--output-format", "text"], { cwd: root, encoding: "utf8" });
const status = Object.fromEntries(statusText.split("\n").map((line) => line.match(/^([A-Z_]+)=(["']?)(.*)\2$/u)).filter(Boolean).map((m) => [m[1], m[3]]));
const apiUrl = status.API_URL;
if (!apiUrl || !/^http:\/\/127\.0\.0\.1:/u.test(apiUrl)) throw new Error("Local Supabase is not running on loopback.");
const key = () => randomBytes(32).toString("base64url");
const sql = (statement) => execFileSync("npx", ["--no-install", "supabase", "db", "query", "--local", statement], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });

async function account(label, role, publicName) {
  const email = `${label}-${randomUUID().slice(0, 8)}@academic-arena.test`;
  const password = `${randomBytes(18).toString("base64url")}Aa1!`;
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`fixture user creation failed: ${response.status}`);
  const user = await response.json();
  const accountId = randomUUID();
  const username = `${label}.${randomUUID().slice(0, 4)}`;
  const name = publicName ? `'${publicName}'` : "null";
  sql(`insert into app_private.accounts (id, provider_user_id, status, force_password_change, public_display_name) values ('${accountId}', '${user.id}', 'active', false, ${name})`);
  sql(`insert into app_private.identity_mappings (account_id, username_normalized, provider_email) values ('${accountId}', '${username}', '${email}')`);
  sql(`insert into app_private.account_role_grants (account_id, role_name) values ('${accountId}', '${role}')`);
  return { role, username, password };
}

const accounts = [
  await account("qa-admin", "admin"),
  await account("qa-student", "student", "Laila Farouk"),
  await account("qa-student", "student", "Karim Saad"),
];
writeFileSync(output, JSON.stringify(accounts, null, 2), { mode: 0o600 });
console.log(`Fictional QA credentials written to ${output}`);

execFileSync("npm", ["run", "build:production"], { cwd: root, stdio: "ignore" });
const devVars = path.join(root, ".dev.vars");
if (existsSync(devVars)) throw new Error(".dev.vars already exists; refusing to overwrite it.");
writeFileSync(devVars, [
  `SUPABASE_URL=${apiUrl}`, `SUPABASE_ANON_KEY=${status.ANON_KEY}`, `SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`,
  `SESSION_JWE_KEY=${key()}`, `RATE_LIMIT_HMAC_KEY=${key()}`, "ENVIRONMENT=test", "",
].join("\n"), { mode: 0o600 });
const child = spawn("npx", ["--no-install", "wrangler", "pages", "dev", "dist", "--ip", "127.0.0.1", "--port", "8789"], { cwd: root, stdio: "ignore" });
const cleanup = () => { rmSync(devVars, { force: true }); child.kill("SIGTERM"); process.exit(0); };
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
console.log("Local live preview: http://127.0.0.1:8789 (Ctrl+C to stop)");
