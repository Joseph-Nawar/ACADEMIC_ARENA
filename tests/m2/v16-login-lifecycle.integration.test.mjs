// V1.6 student sign-in incident (2026-11-20): the whole credential lifecycle,
// with fictional accounts only. Tests that assert diagnostic rows run before
// the high-volume tests, which use the shared no-account diagnostic budget.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { api, cleanupProvisionedIdentity, createIdentity, injectProviderFailure, json, local } from "./bff-fixtures.mjs";
import { queryRows, readExport } from "../../scripts/student-accounts.mjs";
import { hmacSha256Bytea } from "../../functions/lib/secure-crypto.js";

const origin = new URL(local.pagesUrl).origin;
const passphrase = `fictional-test-passphrase-${randomBytes(12).toString("hex")}`;
const letters = (count) => [...randomBytes(count)].map((byte) => "abcdefghjkmnpqrstuvwxyz"[byte % 23]).join("");
const uniqueIp = () => `2001:db8:16::${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}`;

function sql(query) {
  const output = execFileSync("npx", ["--no-install", "supabase", "db", "query", "--local", "--output-format", "json", query], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "ignore"],
  });
  return queryRows(output);
}

function cli(args, { expectFailure = false } = {}) {
  try {
    const output = execFileSync(process.execPath, ["scripts/student-accounts.mjs", ...args], {
      encoding: "utf8", env: { ...process.env, AA_EXPORT_PASSPHRASE: passphrase }, stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(expectFailure, false, "CLI command was expected to fail");
    return output;
  } catch (error) {
    if (!expectFailure) throw new Error(`CLI failed: ${error.stderr || error.message}`);
    return `${error.stdout}${error.stderr}`;
  }
}

function cookieFrom(response) {
  const value = (response.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(value, /^__Host-aa_session=[A-Za-z0-9_-]{43}$/u);
  return value;
}

async function login(username, password, ip = uniqueIp()) {
  const response = await api("/api/auth/login", {
    method: "POST", origin, headers: { "CF-Connecting-IP": ip }, body: { username, password },
  });
  const payload = await json(response);
  if (response.status !== 200) return { status: response.status, payload };
  return { status: 200, payload, cookie: cookieFrom(response), csrfToken: payload.csrfToken };
}

async function changePassword(session, oldPassword, newPassword, ip = uniqueIp()) {
  const response = await api("/api/auth/change-password", {
    method: "POST", origin,
    headers: { Cookie: session.cookie, "X-CSRF-Token": session.csrfToken, "CF-Connecting-IP": ip },
    body: { oldPassword, newPassword },
  });
  return { response, payload: await json(response) };
}

async function sessionState(cookie) {
  return json(await api("/api/auth/session", { headers: { Cookie: cookie } }));
}

async function logout(session) {
  const response = await api("/api/auth/logout", {
    method: "POST", origin, headers: { Cookie: session.cookie, "X-CSRF-Token": session.csrfToken }, body: {},
  });
  assert.ok([200, 204].includes(response.status), "sign-out succeeds");
}

// Diagnostic rows are written after the response (waitUntil), so poll briefly.
async function diagnosticsFor(accountId, minimum) {
  assert.match(accountId, /^[0-9a-f-]{36}$/u);
  let rows = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    rows = sql(`select flow, stage, outcome, temporary_password from app_private.auth_diagnostic_events where account_id = '${accountId}' order by id`);
    if (rows.length >= minimum) return rows;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return rows;
}

const newPassword = () => `Fictional-${randomBytes(12).toString("hex")}`;

test("provisioning: each export password signs in its own account, and a later batch never changes earlier accounts", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "aa-v16-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const tag = letters(6);
  const make = (word, index) => ({ username: `fx16-${word}-${tag}`, email: `v16.${word}.${tag}@academic-arena.test`, ref: `FX16-${tag}-${index}` });
  const batchA = ["alpha", "bravo", "charlie"].map(make);
  const batchB = ["delta", "echo", "foxtrot"].map((word, index) => make(word, index + 3));
  const roster = join(directory, "roster.csv");
  const writeRoster = (rows) => writeFileSync(roster, ["roster_ref,email,username,eligible", ...rows.map((item) => `${item.ref},${item.email},${item.username},yes`)].join("\n"));
  const common = ["--target", "local", "--roster", roster, "--email-domain", "academic-arena.test", "--fictional"];

  writeRoster(batchA);
  cli(["provision", ...common, "--export", join(directory, "a.aacred")]);
  for (const item of batchA) await cleanupProvisionedIdentity(context, item.username);
  const exportA = readExport(join(directory, "a.aacred"), passphrase);
  assert.deepEqual(exportA.map((entry) => entry.username).sort(), batchA.map((item) => item.username).sort());
  const fingerprint = () => sql(`select m.username_normalized as username, md5(u.encrypted_password) as hash, u.updated_at::text as updated
    from app_private.identity_mappings m join app_private.accounts a on a.id = m.account_id join auth.users u on u.id = a.provider_user_id
    where m.username_normalized in (${batchA.map((item) => `'${item.username}'`).join(",")}) order by 1`);
  const before = fingerprint();
  assert.equal(before.length, 3);

  // A second batch for a roster that still lists the first batch.
  writeRoster([...batchA, ...batchB]);
  assert.match(cli(["provision", ...common, "--dry-run"]), /"done":3,"create":3/u, "earlier accounts are recognised as done");
  cli(["provision", ...common, "--export", join(directory, "b.aacred")]);
  for (const item of batchB) await cleanupProvisionedIdentity(context, item.username);
  const exportB = readExport(join(directory, "b.aacred"), passphrase);
  assert.deepEqual(exportB.map((entry) => entry.username).sort(), batchB.map((item) => item.username).sort(),
    "a later export holds only the accounts it created");
  assert.deepEqual(fingerprint(), before, "the later batch did not touch any earlier Auth credential");

  // Every exported credential authenticates exactly its own account.
  for (const entry of [...exportA, ...exportB]) {
    const session = await login(entry.username, entry.password);
    assert.equal(session.status, 200, "an issued temporary credential signs in");
    assert.deepEqual(session.payload.user, { role: "student", mustChangePassword: true });
    await logout(session);
  }
  // A password from one account never opens another.
  assert.equal((await login(exportA[0].username, exportA[1].password)).status, 401);
  // Delivering from the wrong batch's export is refused instead of copying a wrong password.
  assert.match(cli(["deliver", "--export", join(directory, "b.aacred"), "--username", exportA[0].username], { expectFailure: true }),
    /username not in this export/u);
});

test("password change: the temporary password stops working, the student stays signed in, and the new password keeps working", async (context) => {
  const identity = await createIdentity(context, "v16-change");
  const first = await login(identity.username, identity.password);
  assert.equal(first.status, 200);
  assert.equal(first.payload.user.mustChangePassword, true);
  const next = newPassword();

  const { response, payload } = await changePassword(first, identity.password, next);
  assert.equal(response.status, 200);
  assert.equal(payload.changed, true);
  assert.equal(payload.authenticated, true, "a student is signed straight back in with the new password");
  assert.deepEqual(payload.user, { role: "student", mustChangePassword: false });
  assert.match(payload.csrfToken, /^[A-Za-z0-9_-]{43}$/u);
  for (const value of [identity.email, identity.password, next, local.serviceRoleKey]) {
    assert.equal(JSON.stringify(payload).includes(value), false, "the response holds no credentials or emails");
  }
  const renewed = { cookie: cookieFrom(response), csrfToken: payload.csrfToken };
  assert.notEqual(renewed.cookie, first.cookie, "a new session replaces the old one");
  assert.deepEqual(await sessionState(first.cookie), { authenticated: false }, "the pre-change session is revoked");
  const live = await sessionState(renewed.cookie);
  assert.equal(live.authenticated, true);
  assert.equal(live.user.mustChangePassword, false);

  await logout(renewed);
  assert.deepEqual(await sessionState(renewed.cookie), { authenticated: false });
  const old = await login(identity.username, identity.password);
  assert.equal(old.status, 401, "the temporary password no longer works");
  assert.deepEqual(old.payload, { error: "invalid_credentials" });
  for (let round = 0; round < 3; round += 1) {
    const again = await login(identity.username, next);
    assert.equal(again.status, 200, "the new password works on every later sign-in");
    assert.equal(again.payload.user.mustChangePassword, false);
    await logout(again);
  }

  const rows = await diagnosticsFor(identity.accountId, 6);
  assert.deepEqual(rows.slice(0, 3).map((row) => [row.flow, row.stage, row.outcome, row.temporary_password]), [
    ["login", "signed_in", "success", true],
    ["password_change", "changed_signed_in", "success", false],
    ["login", "provider_rejected", "rejected", false],
  ], "each stage is recorded with the account's credential state, no credentials");
  const columns = sql("select column_name from information_schema.columns where table_schema = 'app_private' and table_name = 'auth_diagnostic_events' order by ordinal_position")
    .map((row) => row.column_name);
  assert.deepEqual(columns, ["id", "occurred_at", "correlation_id", "flow", "stage", "outcome", "account_id", "temporary_password", "credential_epoch"],
    "diagnostics hold no username, email, IP, password or token");
});

test("password change: a lost Auth response is reported as uncertain, and the account stays usable", async (context) => {
  const identity = await createIdentity(context, "v16-lost");
  const first = await login(identity.username, identity.password);
  assert.equal(first.status, 200);
  const next = newPassword();
  await injectProviderFailure(identity.user.id, "self-password-update-lost-response");
  const { response, payload } = await changePassword(first, identity.password, next);
  assert.equal(response.status, 503);
  assert.deepEqual(payload, { error: "password_change_uncertain" }, "the student is told the outcome is unknown, not that it failed");
  // Auth did apply it: the new password signs in, and the account still asks
  // for a password change because the change was not confirmed.
  assert.equal((await login(identity.username, identity.password)).status, 401);
  const recovered = await login(identity.username, next);
  assert.equal(recovered.status, 200, "the password the student chose works");
  assert.equal(recovered.payload.user.mustChangePassword, true, "the unconfirmed change is completed at the next sign-in");
  const finalPassword = newPassword();
  const completed = await changePassword(recovered, next, finalPassword);
  assert.equal(completed.response.status, 200);
  assert.equal((await login(identity.username, finalPassword)).status, 200);
  const stages = (await diagnosticsFor(identity.accountId, 3)).map((row) => row.stage);
  assert.ok(stages.includes("provider_update_uncertain"), "the uncertain update is recorded for investigation");
});

test("password change: if the automatic sign-in is unavailable, the change still stands and the student signs in normally", async (context) => {
  const identity = await createIdentity(context, "v16-noauto");
  const first = await login(identity.username, identity.password);
  assert.equal(first.status, 200);
  const next = newPassword();
  await injectProviderFailure(identity.user.id, "password-grant-unavailable", {
    passwordSha256: createHash("sha256").update(next).digest("hex"),
  });
  const { response, payload } = await changePassword(first, identity.password, next);
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { changed: true, authenticated: false }, "the change is reported as done, with no session");
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/u, "the old cookie is cleared");
  assert.deepEqual(await sessionState(first.cookie), { authenticated: false }, "the pre-change session is revoked");
  assert.equal((await login(identity.username, identity.password)).status, 401, "the temporary password no longer works");
  const again = await login(identity.username, next);
  assert.equal(again.status, 200, "the student is not trapped: the new password signs in");
  assert.equal(again.payload.user.mustChangePassword, false, "the change was completed, so no second change is asked for");
  const stages = (await diagnosticsFor(identity.accountId, 3)).map((row) => row.stage);
  assert.ok(stages.includes("changed"), "the fallback is recorded as a completed change without automatic sign-in");
});

test("limiter: successful sign-ins never use the allowance, but eight failures still lock the account across IPs", async (context) => {
  const identity = await createIdentity(context, "v16-brute");
  for (let round = 0; round < 12; round += 1) {
    const session = await login(identity.username, identity.password);
    assert.equal(session.status, 200, `successful sign-in ${round + 1} is not throttled`);
    await logout(session);
  }
  const failures = await Promise.all(Array.from({ length: 8 }, () => login(identity.username, "incorrect-fictional-password")));
  assert.ok(failures.every((result) => result.status === 401));
  for (const ip of [uniqueIp(), uniqueIp()]) {
    const blocked = await login(identity.username, identity.password, ip);
    assert.equal(blocked.status, 401, "after eight failures even the right password waits out the window, from any IP");
    assert.deepEqual(blocked.payload, { error: "invalid_credentials" }, "throttling looks exactly like a wrong password");
  }
  const stages = (await diagnosticsFor(identity.accountId, 21)).map((row) => row.stage);
  assert.equal(stages.filter((stage) => stage === "rate_limited").length, 1,
    "a throttled account is recorded privately, once per limiter window");
});

test("shared campus IP: a cohort completes first sign-in, a typo, password change and re-sign-in concurrently", async (context) => {
  const campusIp = uniqueIp();
  const cohort = [];
  for (let index = 0; index < 24; index += 1) cohort.push(await createIdentity(context, "v16-cohort"));
  const results = await Promise.all(cohort.map(async (identity) => {
    const typo = await login(identity.username, `${identity.password}x`, campusIp);
    const first = await login(identity.username, identity.password, campusIp);
    if (first.status !== 200) return `first sign-in ${first.status}`;
    const next = newPassword();
    const { response, payload } = await changePassword(first, identity.password, next, campusIp);
    if (response.status !== 200 || payload.authenticated !== true) return `change ${response.status}`;
    await logout({ cookie: cookieFrom(response), csrfToken: payload.csrfToken });
    const again = await login(identity.username, next, campusIp);
    return typo.status === 401 && again.status === 200 ? "ok" : `re-sign-in ${again.status}`;
  }));
  // 24 students × 4 attempts = 96 limiter calls from one IP (the old limit was
  // 40 attempts, successes included); only the 24 typos count now.
  assert.deepEqual(results, cohort.map(() => "ok"));
  // Concurrent successes refunded exactly their own attempts: the shared IP
  // still counts every student's failure, no more and no less.
  const ipKey = await hmacSha256Bytea(`ip:v1:${campusIp}`, process.env.AA_RATE_LIMIT_HMAC_KEY);
  assert.match(ipKey, /^\\x[0-9a-f]{64}$/u);
  const [bucket] = sql(`select attempt_count from app_private.login_rate_limit_buckets
    where bucket_kind = 'client_ip' and bucket_key = decode('${ipKey.slice(2)}', 'hex')`);
  assert.equal(Number(bucket?.attempt_count), 24, "the campus IP counts exactly the 24 failures");
});

test("aggregate abuse from one IP is still stopped, with the same generic response", async (context) => {
  const attackerIp = uniqueIp();
  const identity = await createIdentity(context, "v16-abuse");
  for (let chunk = 0; chunk < 4; chunk += 1) {
    const attempts = await Promise.all(Array.from({ length: 25 }, () =>
      login(`nobody-${letters(10)}`, "incorrect-fictional-password", attackerIp)));
    assert.ok(attempts.every((result) => result.status === 401 && result.payload.error === "invalid_credentials"));
  }
  const blocked = await login(identity.username, identity.password, attackerIp);
  assert.equal(blocked.status, 401, "after 100 failures the IP is throttled, even for a real account");
  assert.deepEqual(blocked.payload, { error: "invalid_credentials" });
  assert.equal((await login(identity.username, identity.password)).status, 200, "other networks are unaffected");
});
