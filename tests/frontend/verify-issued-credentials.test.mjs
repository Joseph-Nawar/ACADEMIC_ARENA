import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { bcryptMatches, classify } from "../../scripts/verify-issued-credentials.mjs";

const hasHtpasswd = spawnSync("htpasswd", ["-h"]).error === undefined;

test("issued-credential check: a wrong or changed password is detected, the issued one matches", { skip: hasHtpasswd ? false : "htpasswd is not installed on this runner (it is on macOS, where operators run the check)" }, () => {
  const issued = "Abc23defGhi45jkLmn67";
  // Supabase Auth stores $2a$ bcrypt hashes; htpasswd -B produces $2y$, the same algorithm.
  const line = execFileSync("htpasswd", ["-n", "-B", "-i", "x"], { input: `${issued}\n`, encoding: "utf8" }).trim();
  const hash = line.slice(2).replace(/^\$2y\$/u, "$2a$");
  assert.equal(bcryptMatches(issued, hash), true);
  assert.equal(bcryptMatches(`${issued} `, hash), false, "a trailing space is a different password");
  assert.equal(bcryptMatches("Abc23defGhi45jkLmn68", hash), false);
  assert.equal(bcryptMatches(issued, null), null, "no hash is reported, not guessed");
  assert.equal(bcryptMatches(issued, "not-a-hash"), null);
});

test("issued-credential check: outcomes separate first-time problems from changed passwords", () => {
  const base = { status: "active", credential_update_pending: false };
  assert.equal(classify({}, undefined, null), "not_provisioned");
  assert.equal(classify({}, { ...base, force_password_change: true, has_signed_in: false }, true), "temporary_valid");
  assert.equal(classify({}, { ...base, force_password_change: false, has_signed_in: true }, false), "changed_by_student");
  assert.equal(classify({}, { ...base, force_password_change: true, has_signed_in: false }, false), "MISMATCH_UNUSED");
  assert.equal(classify({}, { ...base, force_password_change: true, has_signed_in: true }, false), "MISMATCH_USED");
  assert.equal(classify({}, { ...base, status: "suspended", force_password_change: true }, true), "account_blocked");
  assert.equal(classify({}, { ...base, credential_update_pending: true, force_password_change: true }, true), "account_blocked");
  assert.equal(classify({}, { ...base, force_password_change: true }, null), "no_hash");
});
