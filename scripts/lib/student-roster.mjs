// Pure helpers for operator student provisioning (no network, no I/O).
// The private roster stays on the operator's device; these functions never
// log row contents. Errors carry line numbers and a reason only.
import { randomInt } from "node:crypto";

export const ROSTER_COLUMNS = Object.freeze(["roster_ref", "email", "username", "eligible"]);
export const MAX_ROSTER_ROWS = 1000;
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/u;
const EMAIL_PATTERN = /^[a-z0-9._%+-]{1,64}@([a-z0-9-]+\.)+[a-z]{2,}$/u;
const RESERVED = new Set(["admin", "administrator", "staff", "root", "support", "system", "operator", "moderator", "publisher", "test"]);
// Fictional identities only on non-production projects and only with --fictional.
export const FICTIONAL_DOMAIN = "academic-arena.test";

function splitLine(line) {
  return line.split(",").map((value) => value.trim());
}

// Usernames must not reveal a name, email, or student number.
export function usernameProblem(username, { rosterRef, email }) {
  if (!USERNAME_PATTERN.test(username)) return "username must be 3–32 lowercase letters, digits, . _ -";
  if (RESERVED.has(username)) return "username is reserved";
  if (/\d{5,}/u.test(username)) return "username must not contain long digit runs (student-number-like)";
  const compact = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/gu, "");
  const ref = compact(rosterRef);
  const local = compact(String(email || "").split("@")[0]);
  const name = compact(username);
  if (ref.length >= 3 && name.includes(ref)) return "username must not contain the roster reference";
  if (local.length >= 3 && (name.includes(local) || local.includes(name))) return "username must not be derived from the email address";
  return null;
}

// Returns { ok, rows, errors } where rows are eligible students only.
export function validateRoster(text, { emailDomains, fictional = false }) {
  const errors = [];
  const fail = (line, reason) => { if (errors.length < 50) errors.push({ line, reason }); };
  const domains = new Set((emailDomains || []).map((domain) => String(domain).toLowerCase()));
  if (!domains.size) return { ok: false, rows: [], errors: [{ line: 0, reason: "at least one approved --email-domain is required" }] };
  if (domains.has(FICTIONAL_DOMAIN) !== fictional || (fictional && domains.size !== 1)) {
    return { ok: false, rows: [], errors: [{ line: 0, reason: `--fictional requires exactly --email-domain ${FICTIONAL_DOMAIN}, and real domains forbid it` }] };
  }
  if (typeof text !== "string" || !text.trim()) return { ok: false, rows: [], errors: [{ line: 0, reason: "roster is empty" }] };
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const header = splitLine(lines[0]).map((value) => value.toLowerCase());
  if (header.join(",") !== ROSTER_COLUMNS.join(",")) {
    return { ok: false, rows: [], errors: [{ line: 1, reason: `header must be exactly ${ROSTER_COLUMNS.join(",")}` }] };
  }
  if (lines.length - 1 > MAX_ROSTER_ROWS) return { ok: false, rows: [], errors: [{ line: 0, reason: `at most ${MAX_ROSTER_ROWS} rows` }] };
  const seen = { ref: new Map(), email: new Map(), username: new Map() };
  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = index + 1;
    if (!lines[index].trim()) { fail(line, "blank line"); continue; }
    if (/["'<>;=\\]/u.test(lines[index])) { fail(line, "quotes, markup, and formula characters are not allowed"); continue; }
    const fields = splitLine(lines[index]);
    if (fields.length !== 4) { fail(line, "expected 4 values"); continue; }
    const [rosterRef, rawEmail, rawUsername, eligibleText] = fields;
    const email = rawEmail.toLowerCase();
    const username = rawUsername.toLowerCase();
    const eligible = eligibleText.toLowerCase();
    if (!/^[A-Za-z0-9_-]{3,40}$/u.test(rosterRef)) fail(line, "roster_ref must be 3–40 letters, digits, _ or -");
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) fail(line, "invalid email");
    else if (!domains.has(email.split("@")[1])) fail(line, "email domain is not approved");
    const problem = usernameProblem(username, { rosterRef, email });
    if (problem) fail(line, problem);
    if (!["yes", "no"].includes(eligible)) fail(line, "eligible must be yes or no");
    for (const [kind, value] of [["ref", rosterRef.toLowerCase()], ["email", email], ["username", username]]) {
      if (seen[kind].has(value)) fail(line, `duplicate ${kind === "ref" ? "roster_ref" : kind} (also line ${seen[kind].get(value)})`);
      else seen[kind].set(value, line);
    }
    if (eligible === "yes") rows.push({ line, email, username });
  }
  return { ok: errors.length === 0, rows: errors.length ? [] : rows, errors };
}

// 20 characters from a 56-symbol unambiguous alphabet (~116 bits), with at
// least one lowercase, uppercase, and digit.
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function temporaryPassword(length = 20) {
  for (;;) {
    let value = "";
    for (let index = 0; index < length; index += 1) value += ALPHABET[randomInt(ALPHABET.length)];
    if (/[a-z]/u.test(value) && /[A-Z]/u.test(value) && /\d/u.test(value)) return value;
  }
}

// Decide what to do for each eligible roster row given hosted state.
// state rows: { provider_email, auth_user_id, auth_confirmed, auth_has_signed_in,
//   auth_created_by_tool, account_username }
export function planProvisioning(rows, stateRows, takenUsernames, { adoptOrphans = false } = {}) {
  const byEmail = new Map(stateRows.map((row) => [row.provider_email, row]));
  const taken = new Set(takenUsernames);
  return rows.map((row) => {
    const state = byEmail.get(row.email) || {};
    if (state.account_username) {
      return { ...row, action: state.account_username === row.username ? "done" : "conflict", reason: "email already mapped to another username" };
    }
    if (taken.has(row.username)) return { ...row, action: "conflict", reason: "username already in use" };
    if (state.auth_user_id) {
      if (state.auth_created_by_tool && !state.auth_has_signed_in && state.auth_confirmed) {
        return adoptOrphans
          ? { ...row, action: "adopt", authUserId: state.auth_user_id }
          : { ...row, action: "orphan", reason: "provider user from an interrupted run; rerun with --adopt-orphans" };
      }
      return { ...row, action: "orphan", reason: "provider user exists and was not created by this tool or has signed in; review manually" };
    }
    return { ...row, action: "create" };
  });
}
