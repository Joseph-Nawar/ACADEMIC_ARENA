// Operator CLI for staff-issued student accounts (V1.2). Runs only on the
// authorized operator's device. It uses the supported Supabase Auth Admin API
// for credentials and owner-only database functions for application state.
// It never prints passwords, emails, roster references, keys, or tokens.
//
//   node scripts/student-accounts.mjs validate  --roster F --email-domain D [--fictional]
//   node scripts/student-accounts.mjs status    --target REF|local --roster F --email-domain D [--fictional]
//   node scripts/student-accounts.mjs provision --target REF|local --roster F --email-domain D --export OUT.aacred
//                                                [--batch-size 25] [--dry-run] [--adopt-orphans] [--fictional]
//   node scripts/student-accounts.mjs reset     --target REF|local --username U --verified-ref CODE --export OUT.aacred
//   node scripts/student-accounts.mjs suspend|reactivate --target REF|local --username U --reason CODE
//   node scripts/student-accounts.mjs deliver   --export F.aacred --username U     (copies one password to the clipboard)
//   node scripts/student-accounts.mjs features  --target REF|local [--set name=on|off] [--confirm-production]
//
// Secrets: the export passphrase comes from AA_EXPORT_PASSPHRASE (>= 24 chars,
// e.g. set with `read -s`), never argv. Hosted targets use the Supabase CLI
// login (keychain or SUPABASE_ACCESS_TOKEN) for the Management API and fetch
// the service key into memory only. Local targets read `supabase status`.
import { execFileSync, spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { planProvisioning, temporaryPassword, USERNAME_PATTERN, validateRoster } from "./lib/student-roster.mjs";

export const PRODUCTION_REF = "jhukafyrdredfkzyzggw";
const FEATURES = ["student_sign_in", "student_provisioning", "avatar_personalization", "welcome_dialog",
  // Release B (present once migration 202611270001 is applied).
  "character_studio_v2", "cosmetic_rewards"];
const CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;

function die(message, code = 2) {
  console.error(`error: ${message}`);
  process.exit(code);
}

// ---------------------------------------------------------------- transport
function managementToken() {
  let value = process.env.SUPABASE_ACCESS_TOKEN;
  if (!value) {
    value = execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-w"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (value.startsWith("go-keyring-base64:")) value = Buffer.from(value.slice(18), "base64").toString("utf8").trim();
  }
  if (!/^sbp_[A-Za-z0-9_]{20,}$/u.test(value)) die("Supabase CLI login not found; run npx supabase login.");
  return value;
}

async function fetchJson(url, init, label) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch {
    const error = new Error(`${label}: no response (timeout or network)`);
    error.uncertain = true;
    throw error;
  }
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`${label}: HTTP ${response.status}`);
    error.status = response.status;
    error.uncertain = response.status >= 500 || response.status === 429;
    try { error.code = JSON.parse(text).error_code || JSON.parse(text).code; } catch { /* no body */ }
    const reason = databaseReason(text);
    if (reason) error.message += ` — ${reason}`;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

// The CLI may print notices before or after its JSON document, and prints
// either a bare array of rows or (in some environments) {"rows": [...]}.
// Take the first balanced [...] or {...} value, string-aware.
export function firstJsonValue(text) {
  const start = text.search(/[[{]/u);
  let depth = 0;
  let inString = false;
  for (let index = start; start >= 0 && index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if ((char === "}" || char === "]") && --depth === 0) return JSON.parse(text.slice(start, index + 1));
  }
  throw new Error("local SQL returned no JSON result");
}

export function queryRows(text) {
  const value = firstJsonValue(text);
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.rows)) return value.rows;
  throw new Error("local SQL returned an unexpected result shape");
}

// Only the raised message of a database error, with emails redacted.
function databaseReason(text) {
  const match = /ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([^\n"\\]{1,160})/u.exec(String(text));
  return match ? match[1].replace(/[^\s@]+@[^\s@]+/gu, "[email]").trim() : null;
}

const sqlLiteral = (value) => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  const tag = `aa_${randomBytes(6).toString("hex")}`;
  return `$${tag}$${String(value)}$${tag}$`;
};
const sqlTextArray = (values) => `array[${values.map(sqlLiteral).join(",")}]::text[]`;

export async function connect(target) {
  if (target === "local") {
    const status = Object.fromEntries(execFileSync("npx", ["--no-install", "supabase", "status", "--env", "--output-format", "text"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).split("\n").map((line) => line.match(/^([A-Z_]+)=["']?([^"']*)["']?$/u)).filter(Boolean).map((match) => [match[1], match[2]]));
    if (!status.API_URL || !status.SERVICE_ROLE_KEY) die("local Supabase stack is not running");
    return {
      target, production: false, url: status.API_URL, serviceKey: status.SERVICE_ROLE_KEY,
      async sql(query) {
        // The SQL (which may name roster emails) goes through a private
        // temporary file, never the process arguments visible in `ps`.
        const directory = mkdtempSync(join(tmpdir(), "aa-sql-"));
        const file = join(directory, "query.sql");
        let output;
        try {
          writeFileSync(file, query, { mode: 0o600, flag: "wx" });
          output = execFileSync("npx", ["--no-install", "supabase", "db", "query", "--local", "--output-format", "json", "-f", file], {
            encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (error) {
          const reason = databaseReason(`${error.stdout}${error.stderr}`);
          throw new Error(`local SQL failed${reason ? ` — ${reason}` : ""}`);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
        return queryRows(output);
      },
    };
  }
  if (!/^[a-z0-9]{20}$/u.test(target || "")) die("--target must be a Supabase project ref or local");
  const token = managementToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const keys = await fetchJson(`https://api.supabase.com/v1/projects/${target}/api-keys?reveal=true`, { headers }, "Management API keys");
  const service = keys.find((key) => key.name === "service_role" && key.api_key) || keys.find((key) => key.type === "secret" && key.api_key);
  if (!service) die("no service key available for this project");
  // The public anon key too (memory only): acceptance tests use it to attempt
  // direct REST access the way an attacker with the public key could.
  const anon = keys.find((key) => key.name === "anon" && key.api_key) || keys.find((key) => key.type === "publishable" && key.api_key);
  return {
    target, production: target === PRODUCTION_REF, url: `https://${target}.supabase.co`, serviceKey: service.api_key, anonKey: anon?.api_key,
    async sql(query) {
      return fetchJson(`https://api.supabase.com/v1/projects/${target}/database/query`, {
        method: "POST", headers, body: JSON.stringify({ query }),
      }, "Management API SQL");
    },
  };
}

function authAdmin(connection) {
  const headers = { apikey: connection.serviceKey, Authorization: `Bearer ${connection.serviceKey}`, "Content-Type": "application/json" };
  const base = `${connection.url}/auth/v1/admin/users`;
  return {
    create: (email, password) => fetchJson(base, {
      method: "POST", headers,
      // Confirmed because the email comes from the university-approved roster;
      // no confirmation email is sent. Marked so interrupted runs can be adopted.
      body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { aa_provisioning: "v1" } }),
    }, "Auth Admin create"),
    setPassword: (id, password) => fetchJson(`${base}/${encodeURIComponent(id)}`, {
      method: "PUT", headers, body: JSON.stringify({ password }),
    }, "Auth Admin update"),
  };
}

// ---------------------------------------------------------------- credential export
const MAGIC = Buffer.from("AACR1");
function passphrase() {
  const value = process.env.AA_EXPORT_PASSPHRASE || "";
  delete process.env.AA_EXPORT_PASSPHRASE;
  if (value.length < 24) die("set AA_EXPORT_PASSPHRASE (>= 24 characters, separate from any backup passphrase) with read -s");
  return value;
}
const derive = (secret, salt) => scryptSync(secret, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });

function writeExport(path, secret, entries) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(secret, salt), iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(JSON.stringify({ version: 1, entries })), cipher.final()]);
  writeFileSync(path, Buffer.concat([MAGIC, salt, iv, body, cipher.getAuthTag()]), { mode: 0o600, flag: "wx" });
}

export function readExport(path, secret) {
  const data = readFileSync(path);
  if (data.length < 50 || !data.subarray(0, 5).equals(MAGIC)) die("not an Academic Arena credential export", 1);
  const decipher = createDecipheriv("aes-256-gcm", derive(secret, data.subarray(5, 21)), data.subarray(21, 33));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(data.subarray(data.length - 16));
  try {
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(33, data.length - 16)), decipher.final()]).toString("utf8")).entries;
  } catch {
    return die("decryption failed: wrong passphrase or modified file", 1);
  }
}

// ---------------------------------------------------------------- commands
function loadRoster(values) {
  if (!values.roster) die("--roster is required");
  const domains = [values["email-domain"]].flat().filter(Boolean);
  const result = validateRoster(readFileSync(values.roster, "utf8"), { emailDomains: domains, fictional: values.fictional === true });
  if (!result.ok) {
    for (const error of result.errors) console.error(`line ${error.line}: ${error.reason}`);
    die(`roster rejected (${result.errors.length} problem(s)); nothing was changed`, 1);
  }
  return result.rows;
}

// Checked before any network call.
function guardTarget(values) {
  if (values.target === PRODUCTION_REF && values.fictional) die("fictional identities are never provisioned in production");
}

async function features(connection) {
  // Every known switch the database has (older databases lack the Release B ones).
  const [row] = await connection.sql("select * from app_private.student_feature_controls");
  return Object.fromEntries(FEATURES.filter((name) => Object.hasOwn(row, name)).map((name) => [name, row[name]]));
}

async function hostedState(connection, rows) {
  const state = await connection.sql(`select * from app_private.operator_student_provisioning_state(${sqlTextArray(rows.map((row) => row.email))})`);
  const taken = (await connection.sql(`select username from app_private.operator_username_taken(${sqlTextArray(rows.map((row) => row.username))})`))
    .map((row) => row.username);
  // A username may legitimately be "taken" by the same student's own mapping.
  const own = new Set(state.filter((row) => row.account_username).map((row) => row.account_username));
  return { state, taken: taken.filter((username) => !own.has(username)) };
}

function summarize(plan) {
  const counts = {};
  for (const item of plan) counts[item.action] = (counts[item.action] || 0) + 1;
  return counts;
}

async function provision(values) {
  guardTarget(values);
  const rows = loadRoster(values);
  const connection = await connect(values.target);
  const batchSize = Number(values["batch-size"] || 25);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) die("--batch-size must be 1–50");
  const { state, taken } = await hostedState(connection, rows);
  const plan = planProvisioning(rows, state, taken, { adoptOrphans: values["adopt-orphans"] === true });
  console.log(`plan: ${JSON.stringify(summarize(plan))}`);
  for (const item of plan.filter((entry) => ["conflict", "orphan"].includes(entry.action))) {
    console.log(`  roster line ${item.line}: ${item.action} — ${item.reason}`);
  }
  if (values["dry-run"]) return;
  const flags = await features(connection);
  if (!flags?.student_provisioning) die("student_provisioning is off for this project; nothing was changed");
  if (!values.export || existsSync(values.export)) die("--export must name a new file for the encrypted credentials");
  const secret = passphrase();
  const admin = authAdmin(connection);
  const issued = [];
  const results = { created: 0, adopted: 0, failed: 0 };
  let stopReason = null;
  for (const item of plan.filter((entry) => ["create", "adopt"].includes(entry.action)).slice(0, batchSize)) {
    const password = temporaryPassword();
    try {
      let userId = item.authUserId;
      if (item.action === "create") {
        const user = await admin.create(item.email, password);
        userId = user.id;
      } else {
        await admin.setPassword(userId, password);
      }
      const [{ result }] = await connection.sql(`select app_private.operator_provision_student(${sqlLiteral(userId)}::uuid, ${sqlLiteral(item.username)}, ${sqlLiteral(item.email)}) as result`);
      if (!["created", "exists"].includes(result)) throw new Error("unexpected database result");
      issued.push({ username: item.username, email: item.email, password, issuedAt: new Date().toISOString() });
      results[item.action === "create" ? "created" : "adopted"] += 1;
    } catch (error) {
      results.failed += 1;
      console.error(`  roster line ${item.line}: failed (${error.message}); rerun later to reconcile${error.uncertain ? " with --adopt-orphans" : ""}`);
      if (error.uncertain) { stopReason = "provider did not answer clearly; stopping this batch"; break; }
    }
  }
  if (issued.length) writeExport(values.export, secret, issued);
  console.log(`result: ${JSON.stringify(results)}${issued.length ? `; ${issued.length} credential(s) encrypted to ${values.export}` : "; no export written"}`);
  if (stopReason) console.log(stopReason);
  if (results.failed) process.exitCode = 1;
}

async function status(values) {
  guardTarget(values);
  const rows = loadRoster(values);
  const connection = await connect(values.target);
  const { state, taken } = await hostedState(connection, rows);
  const byEmail = new Map(state.map((row) => [row.provider_email, row]));
  const extra = { mustChangePassword: 0, signedIn: 0, suspended: 0, recoveryPending: 0 };
  for (const row of rows) {
    const item = byEmail.get(row.email);
    if (!item?.account_username) continue;
    if (item.force_password_change) extra.mustChangePassword += 1;
    if (item.auth_has_signed_in) extra.signedIn += 1;
    if (item.account_status === "suspended") extra.suspended += 1;
    if (item.credential_update_pending) extra.recoveryPending += 1;
  }
  console.log(`plan: ${JSON.stringify(summarize(planProvisioning(rows, state, taken)))}`);
  console.log(`accounts: ${JSON.stringify(extra)}`);
  console.log(`features: ${JSON.stringify(await features(connection))}`);
}

async function reset(values) {
  const username = String(values.username || "").toLowerCase();
  if (!USERNAME_PATTERN.test(username)) die("--username is required");
  if (!CODE_PATTERN.test(values["verified-ref"] || "")) die("--verified-ref (an identity-verification reference such as a ticket code) is required");
  if (!values.export || existsSync(values.export)) die("--export must name a new file for the encrypted credential");
  const secret = passphrase();
  const connection = await connect(values.target);
  // Step 1 locks the account: sessions revoked, sign-in blocked, new epoch.
  const [{ provider_user_id: userId, credential_epoch: epoch }] = await connection.sql(
    `select * from app_private.operator_begin_student_recovery(${sqlLiteral(username)}, ${sqlLiteral(values["verified-ref"])})`);
  if (!/^[0-9a-f-]{36}$/u.test(String(userId)) || !/^\d+$/u.test(String(epoch))) die("unexpected database result; the account stays locked", 1);
  const password = temporaryPassword();
  try {
    await authAdmin(connection).setPassword(userId, password);
  } catch (error) {
    // Conservative: the account stays locked; never auto-released by time.
    die(`password update not confirmed (${error.message}). The account stays locked; rerun reset for a fresh password.`, 1);
  }
  // Save the credential before unlocking, so an unlocked account always has a deliverable password.
  writeExport(values.export, secret, [{ username, password, issuedAt: new Date().toISOString() }]);
  await connection.sql(`select app_private.operator_finish_student_recovery(${sqlLiteral(username)}, ${Number(epoch)})`);
  console.log(`reset complete for ${username}; sessions revoked; password change required at next sign-in; credential encrypted to ${values.export}`);
}

async function setStatus(values, statusValue) {
  const username = String(values.username || "").toLowerCase();
  if (!USERNAME_PATTERN.test(username) || !CODE_PATTERN.test(values.reason || "")) die("--username and --reason CODE are required");
  const connection = await connect(values.target);
  await connection.sql(`select app_private.operator_set_student_status(${sqlLiteral(username)}, ${sqlLiteral(statusValue)}, ${sqlLiteral(values.reason)})`);
  console.log(`${username}: ${statusValue}`);
}

function deliver(values) {
  if (!values.export) die("--export is required");
  const entries = readExport(values.export, passphrase());
  if (values.list) {
    console.log(`${entries.length} credential(s): ${entries.map((entry) => entry.username).join(", ")}`);
    return;
  }
  const entry = entries.find((item) => item.username === String(values.username || "").toLowerCase());
  if (!entry) die("username not in this export", 1);
  const copied = spawnSync("pbcopy", { input: entry.password });
  if (copied.status !== 0) die("clipboard unavailable; nothing was printed", 1);
  console.log(`temporary password for ${entry.username} copied to the clipboard (clear it after the verified hand-off)`);
}

async function featureCommand(values) {
  const connection = await connect(values.target);
  if (values.set) {
    const match = /^([a-z0-9_]+)=(on|off)$/u.exec(values.set);
    if (!match || !FEATURES.includes(match[1])) die(`--set must be one of ${FEATURES.join(", ")} =on|off`);
    if (connection.production && match[2] === "on" && !values["confirm-production"]) {
      die("enabling a production feature needs --confirm-production (after written university approval and staging sign-off)");
    }
    await connection.sql(`select app_private.operator_set_student_feature(${sqlLiteral(match[1])}, ${match[2] === "on"})`);
  }
  console.log(JSON.stringify(await features(connection)));
}

const options = {
  roster: { type: "string" }, "email-domain": { type: "string", multiple: true }, fictional: { type: "boolean" },
  target: { type: "string" }, export: { type: "string" }, "batch-size": { type: "string" }, "dry-run": { type: "boolean" },
  "adopt-orphans": { type: "boolean" }, username: { type: "string" }, "verified-ref": { type: "string" },
  reason: { type: "string" }, list: { type: "boolean" }, set: { type: "string" }, "confirm-production": { type: "boolean" },
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({ args: rest, options, strict: true });
  const commands = {
    validate: () => console.log(`roster valid: ${loadRoster(values).length} eligible student(s)`),
    status: () => status(values),
    provision: () => provision(values),
    reset: () => reset(values),
    suspend: () => setStatus(values, "suspended"),
    reactivate: () => setStatus(values, "active"),
    deliver: () => deliver(values),
    features: () => featureCommand(values),
  };
  if (!commands[command]) die("command must be validate, status, provision, reset, suspend, reactivate, deliver, or features");
  try {
    await commands[command]();
  } catch (error) {
    // Database errors carry only the function's message (no row data).
    die(error.message.replace(/sbp_[A-Za-z0-9_]+|eyJ[A-Za-z0-9._-]+/gu, "[redacted]"), 1);
  }
}
