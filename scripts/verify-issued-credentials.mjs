// Read-only check that every temporary password in one or more encrypted
// credential exports (.aacred) is the password Supabase Auth actually holds
// for that account. Runs only on the authorized operator's Mac.
//
//   read -s AA_EXPORT_PASSPHRASE && export AA_EXPORT_PASSPHRASE
//   node scripts/verify-issued-credentials.mjs --target REF|local --export A.aacred [--export B.aacred ...]
//
// How: reads each account's bcrypt hash (auth.users.encrypted_password) over
// the Management API into memory, and verifies the exported password against
// it locally with macOS `htpasswd -v` (password on stdin, hash in a private
// temporary file that is deleted at once). Nothing is signed in, nothing is
// written to the database, and no password, hash or email is printed or sent
// anywhere. Output: counts per outcome, and usernames only for problems.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { connect, readExport } from "./student-accounts.mjs";
import { USERNAME_PATTERN } from "./lib/student-roster.mjs";

const OUTCOMES = {
  temporary_valid: "temporary password is valid (student has not set their own yet)",
  changed_by_student: "student already set their own password (temporary password correctly retired)",
  MISMATCH_UNUSED: "PROBLEM: issued temporary password is NOT accepted, and the account was never used",
  MISMATCH_USED: "PROBLEM: issued temporary password is NOT accepted, the account still requires a change, and it signed in before",
  matches_but_changed: "matches, yet the account no longer requires a change (check)",
  not_provisioned: "PROBLEM: username has no account/mapping in this project",
  account_blocked: "PROBLEM: account is suspended or locked for a staff recovery",
  no_hash: "PROBLEM: Auth holds no password for this account",
};

// Exit code 0 = match, 3 = mismatch (htpasswd); anything else is an error.
export function bcryptMatches(password, hash) {
  if (typeof hash !== "string" || !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/u.test(hash)) return null;
  const directory = mkdtempSync(join(tmpdir(), "aa-verify-"));
  const file = join(directory, "h");
  try {
    writeFileSync(file, `x:${hash}\n`, { mode: 0o600, flag: "wx" });
    execFileSync("htpasswd", ["-v", "-i", file, "x"], { input: `${password}\n`, stdio: ["pipe", "ignore", "ignore"] });
    return true;
  } catch (error) {
    if (error.status === 3) return false;
    throw new Error("htpasswd could not verify the hash");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function classify(entry, row, matches) {
  if (!row) return "not_provisioned";
  if (row.status !== "active" || row.credential_update_pending === true) return "account_blocked";
  if (matches === null) return "no_hash";
  if (matches) return row.force_password_change ? "temporary_valid" : "matches_but_changed";
  if (!row.force_password_change) return "changed_by_student";
  return row.has_signed_in ? "MISMATCH_USED" : "MISMATCH_UNUSED";
}

const sqlText = (value) => `'${String(value).replace(/'/gu, "''")}'`;

async function main() {
  const { values } = parseArgs({ options: { target: { type: "string" }, export: { type: "string", multiple: true } }, strict: true });
  if (!values.target || !values.export?.length) {
    console.error("usage: verify-issued-credentials.mjs --target REF|local --export F.aacred [--export G.aacred ...]");
    process.exit(2);
  }
  const passphrase = process.env.AA_EXPORT_PASSPHRASE || "";
  delete process.env.AA_EXPORT_PASSPHRASE;
  if (passphrase.length < 24) {
    console.error("set AA_EXPORT_PASSPHRASE with read -s (the same passphrase used for the exports)");
    process.exit(2);
  }
  const entries = [];
  for (const file of values.export) {
    for (const entry of readExport(file, passphrase)) entries.push({ ...entry, file });
  }
  const usernames = [...new Set(entries.map((entry) => entry.username))];
  if (usernames.some((username) => !USERNAME_PATTERN.test(username))) throw new Error("an export holds an invalid username");
  const connection = await connect(values.target);
  const rows = await connection.sql(`select m.username_normalized as username, u.encrypted_password as hash,
      a.status, a.force_password_change, a.credential_update_pending, (u.last_sign_in_at is not null) as has_signed_in,
      (lower(u.email) = m.provider_email) as email_matches
    from app_private.identity_mappings m
    join app_private.accounts a on a.id = m.account_id
    join auth.users u on u.id = a.provider_user_id
    where m.username_normalized in (${usernames.map(sqlText).join(",")})`);
  const byUsername = new Map(rows.map((row) => [row.username, row]));

  const counts = {};
  const problems = [];
  const issuedTwice = usernames.filter((username) => entries.filter((entry) => entry.username === username).length > 1);
  for (const entry of entries) {
    const row = byUsername.get(entry.username);
    let outcome = classify(entry, row, row ? bcryptMatches(entry.password, row.hash) : null);
    if (row && row.email_matches !== true) outcome = "not_provisioned";
    counts[outcome] = (counts[outcome] || 0) + 1;
    if (/^[A-Z]|not_provisioned|account_blocked|no_hash/u.test(outcome)) problems.push(`${entry.username} (${outcome}, from ${entry.file.split("/").pop()})`);
  }
  console.log(`checked ${entries.length} issued credential(s) for ${usernames.length} username(s) in ${values.export.length} export(s); nothing was signed in or changed`);
  for (const [outcome, count] of Object.entries(counts)) console.log(`  ${String(count).padStart(3)}  ${OUTCOMES[outcome]}`);
  if (issuedTwice.length) console.log(`note: issued more than once (only the newest can be valid): ${issuedTwice.join(", ")}`);
  if (problems.length) {
    console.log("accounts needing attention:");
    for (const line of problems) console.log(`  ${line}`);
    process.exitCode = 1;
  } else {
    console.log("no problems: every issued temporary password is either valid in Auth or already replaced by the student");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`error: ${String(error.message).replace(/sbp_[A-Za-z0-9_]+|eyJ[A-Za-z0-9._-]+|\$2[aby]\$[^\s]+/gu, "[redacted]")}`);
    process.exit(1);
  });
}
