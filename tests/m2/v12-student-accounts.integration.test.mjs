// V1.2 end-to-end: operator provisioning (CLI + Auth Admin API), forced first
// password change, avatar opt-in, private staff-approved ranking links, the
// public avatar projection, rollback, recovery, and rollout switches.
// Fictional .test identities on the local stack only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { api, json, local } from "./bff-fixtures.mjs";
import { call, cookieFrom, nextIp, origin, staffSession } from "./m3-helpers.mjs";
import { readExport } from "../../scripts/student-accounts.mjs";

const example = readFileSync(new URL("../../data/ranking-upload.example.csv", import.meta.url), "utf8");
const letters = (count) => [...randomBytes(count)].map((byte) => "abcdefghjkmnpqrstuvwxyz"[byte % 23]).join("");
const passphrase = `fictional-test-passphrase-${randomBytes(12).toString("hex")}`;

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

async function login(username, password) {
  const response = await api("/api/auth/login", {
    method: "POST", origin, headers: { "CF-Connecting-IP": nextIp() }, body: { username, password },
  });
  if (response.status !== 200) return { status: response.status };
  const payload = await json(response);
  return { status: 200, cookie: cookieFrom(response), csrfToken: payload.csrfToken, payload };
}

async function board(level) {
  const response = await api(`/api/public/leaderboards?level=${level}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/u, "personalized boards are never cached");
  return json(response);
}

const linkCsv = (rows) => ["level,rank,username", ...rows.map((row) => row.join(","))].join("\n");

test("V1.2 student accounts: provisioning, first login, opt-in avatars, private links, rollback, recovery, and switches", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "aa-v12-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const tag = letters(6);
  const students = ["alpha", "bravo"].map((word) => ({ username: `fx-${word}-${tag}`, email: `person.${word.slice(0, 1)}.${tag}@academic-arena.test` }));
  const roster = join(directory, "roster.csv");
  writeFileSync(roster, ["roster_ref,email,username,eligible", ...students.map((item, index) => `FX-${tag}-${index},${item.email},${item.username},yes`)].join("\n"));
  const common = ["--target", "local", "--roster", roster, "--email-domain", "academic-arena.test", "--fictional"];

  // ---- provisioning: dry run, bounded batch, idempotent resume, no duplicates
  assert.match(cli(["provision", ...common, "--dry-run"]), /plan: \{"create":2\}/u);
  cli(["provision", ...common, "--batch-size", "1", "--export", join(directory, "first.aacred")]);
  assert.match(cli(["provision", ...common, "--dry-run"]), /"done":1,"create":1/u, "resume sees the finished row");
  cli(["provision", ...common, "--export", join(directory, "second.aacred")]);
  const rerun = cli(["provision", ...common, "--export", join(directory, "third.aacred")]);
  assert.match(rerun, /no export written/u, "a full rerun creates nothing");
  const output = `${rerun}${cli(["status", ...common])}`;
  for (const item of students) assert.doesNotMatch(output, new RegExp(item.email.replace(".", "\\."), "u"), "CLI output never contains emails");
  const credentials = [...readExport(join(directory, "first.aacred"), passphrase), ...readExport(join(directory, "second.aacred"), passphrase)];
  assert.deepEqual(credentials.map((item) => item.username).sort(), students.map((item) => item.username).sort());
  const passwordOf = (username) => credentials.find((item) => item.username === username).password;
  assert.equal(cli(["provision", ...common, "--fictional", "--target", "jhukafyrdredfkzyzggw", "--dry-run"], { expectFailure: true }).includes("never provisioned in production"), true,
    "fictional identities are refused for the production project before any network call");

  // ---- first login forces a password change before any student data
  const [alpha, bravo] = students;
  const first = await login(alpha.username, passwordOf(alpha.username));
  assert.equal(first.status, 200);
  assert.equal(first.payload.user.role, "student");
  assert.equal(first.payload.user.mustChangePassword, true);
  assert.equal((await call(first, "/api/me/avatar")).status, 409, "student data waits for the password change");
  const newPasswords = {};
  for (const item of students) {
    const session = item === alpha ? first : await login(item.username, passwordOf(item.username));
    newPasswords[item.username] = `Fictional-${randomBytes(12).toString("hex")}`;
    const changed = await call(session, "/api/auth/change-password", {
      method: "POST", body: { oldPassword: passwordOf(item.username), newPassword: newPasswords[item.username] },
    });
    assert.equal(changed.status, 200, "temporary password can be replaced");
    assert.equal((await login(item.username, passwordOf(item.username))).status, 401, "temporary password stops working");
  }
  const alphaSession = await login(alpha.username, newPasswords[alpha.username]);
  const bravoSession = await login(bravo.username, newPasswords[bravo.username]);
  assert.equal(alphaSession.payload.user.mustChangePassword, false);

  // ---- avatar choice and opt-in, owned per account
  const save = (session, avatar, showOnLeaderboard) => call(session, "/api/me/avatar", {
    method: "PUT", body: showOnLeaderboard === undefined ? { avatar } : { avatar, showOnLeaderboard },
  });
  const alphaLook = { base: "zein", style: "cartoon3d", tone: "lilac", badge: "⚡" };
  const bravoLook = { base: "habiba2", style: "ink", tone: "gold", badge: "★" };
  const saved = await json(await save(alphaSession, alphaLook));
  assert.equal(saved.showOnLeaderboard, false, "public display defaults to off");
  assert.equal((await save(alphaSession, alphaLook, true)).status, 200);
  assert.equal((await save(bravoSession, bravoLook, true)).status, 200);
  for (const payload of [
    { avatar: { ...alphaLook, base: "../../etc/passwd" }, showOnLeaderboard: true },
    { avatar: { ...alphaLook, tone: "url(https://evil.example/x.png)" } },
    { avatar: alphaLook, showOnLeaderboard: "yes" },
    { avatar: alphaLook, showOnLeaderboard: true, accountId: "someone-else" },
    { avatar: { ...alphaLook, svg: "<svg onload=alert(1)>" } },
  ]) {
    assert.equal((await call(alphaSession, "/api/me/avatar", { method: "PUT", body: payload })).status, 400, "malicious avatar payload rejected");
  }
  assert.deepEqual((await json(await call(alphaSession, "/api/me/avatar"))).avatar, alphaLook, "rejected payloads change nothing");

  // ---- publish fictional rankings, then link one row privately
  const admin = await staffSession(context, "v12-admin", "admin");
  const upload = async (csv, releaseLabel) => json(await call(admin, "/api/staff/leaderboards/drafts", {
    method: "POST", body: { academicYear: "2026-27", releaseLabel, csv },
  }));
  const v1 = (await upload(example, "Week 5")).draft.id;
  assert.equal((await call(admin, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId: v1 } })).status, 200);
  const before = await board(4);
  assert.ok(before.rows.every((row) => row.personalized === false), "unlinked rows use default artwork");

  const preview = (session, csv, publicationId = v1) => call(session, "/api/staff/leaderboards/links/preview", { method: "POST", body: { publicationId, csv } });
  const approve = (session, csv, publicationId = v1) => call(session, "/api/staff/leaderboards/links/approve", { method: "POST", body: { publicationId, csv } });
  const aliceName = before.rows[0].name;
  assert.equal((await call(null, `/api/staff/leaderboards/links?publicationId=${v1}`)).status, 401, "anonymous link reads refused");
  assert.equal((await preview(alphaSession, linkCsv([[4, 1, alpha.username]]))).status, 403, "students cannot link accounts");
  assert.equal((await approve(alphaSession, linkCsv([[4, 1, alpha.username]]))).status, 403, "students cannot claim a ranking");
  assert.equal((await preview(admin, `level,rank,public_name\n4,1,${aliceName}`)).status, 422, "names are never accepted for matching");
  assert.equal((await preview(admin, linkCsv([[4, 1, "no-such-user"]]))).status, 422, "unknown usernames are rejected");
  assert.equal((await preview(admin, linkCsv([[4, 1, admin.identity.username]]))).status, 422, "staff accounts cannot be linked");
  assert.equal((await preview(admin, linkCsv([[4, 1, alpha.username], [4, 2, alpha.username]]))).status, 422, "one account per publication");
  const shown = await json(await preview(admin, linkCsv([[4, 1, alpha.username]])));
  assert.deepEqual(shown.links.map((item) => [item.level, item.position, item.username, item.providerEmail, item.previous]),
    [[4, 1, alpha.username, alpha.email, "new"]], "admins privately see the verified identity");
  assert.deepEqual(await json(await approve(admin, linkCsv([[4, 1, alpha.username]]))), { linked: 1 });

  const linked = await board(4);
  assert.deepEqual(linked.rows[0], { position: 1, name: aliceName, avatar: "zein", style: "cartoon3d", tone: "lilac", badge: "⚡", personalized: true },
    "the linked, opted-in student's own character, with allowlisted fields only");
  assert.ok(linked.rows.slice(1).every((row) => row.personalized === false), "every other row keeps default artwork");
  for (const level of [5, 6]) assert.ok((await board(level)).rows.every((row) => !row.personalized), "an unlinked student is never shown");
  assert.doesNotMatch(JSON.stringify(linked), new RegExp(`${alpha.username}|${alpha.email}|account|email|username`, "u"), "no identifiers in public responses");

  // ---- anonymous and student PostgREST cannot read private links or lists
  for (const [path, body] of [["rpc/list_level_row_links", { p_snapshot_id: v1 }], ["rpc/preview_level_row_links", { p_snapshot_id: v1, p_links: [] }]]) {
    const response = await fetch(new URL(`/rest/v1/${path}`, local.supabaseUrl), {
      method: "POST", headers: { apikey: local.anonKey, Authorization: `Bearer ${local.anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.ok(!response.ok, `anonymous ${path} is refused`);
  }

  // ---- another student cannot change the linked student's appearance
  assert.equal((await save(bravoSession, { ...bravoLook, base: "omar" }, true)).status, 200);
  assert.equal((await board(4)).rows[0].avatar, "zein", "bravo's save only changes bravo's own character");

  // ---- changes and opt-out apply without republishing
  assert.equal((await save(alphaSession, { ...alphaLook, base: "mariam" })).status, 200);
  assert.equal((await board(4)).rows[0].avatar, "mariam", "a new look appears without republishing ranks");
  assert.equal((await save(alphaSession, { ...alphaLook, base: "mariam" }, false)).status, 200);
  assert.equal((await board(4)).rows[0].personalized, false, "opt-out returns to default artwork immediately");
  assert.equal((await save(alphaSession, { ...alphaLook, base: "mariam" }, true)).status, 200);

  // ---- the owner switch turns personalization off without touching rankings
  cli(["features", "--target", "local", "--set", "avatar_personalization=off"]);
  const switchedOff = await board(4);
  assert.equal(switchedOff.rows[0].personalized, false);
  assert.equal(switchedOff.rows[0].name, aliceName, "rankings stay public");
  cli(["features", "--target", "local", "--set", "avatar_personalization=on"]);

  // ---- a new version needs its own approval; rollback restores that version's links
  const renamed = example.replace(/^4,2,[^\n]+$/mu, "4,2,Fictional Newcomer");
  const v2 = (await upload(renamed, "Week 6")).draft.id;
  assert.equal((await call(admin, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId: v2 } })).status, 200);
  assert.equal((await board(4)).rows[0].personalized, false, "links are never carried forward silently");
  const carried = await json(await preview(admin, linkCsv([[4, 1, alpha.username]]), v2));
  assert.equal(carried.links[0].previous, "unchanged", "staff see that the same account held the same name before");
  await approve(admin, linkCsv([[4, 1, alpha.username]]), v2);
  assert.equal((await board(4)).rows[0].personalized, true);
  assert.equal((await call(admin, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId: v1 } })).status, 200, "rollback");
  assert.equal((await board(4)).rows[0].avatar, "mariam", "rollback restores version 1 and its links");

  // ---- recovery: sessions revoked, old password dead, fresh temporary password must be changed
  cli(["reset", "--target", "local", "--username", alpha.username, "--verified-ref", "fictional-ticket-1", "--export", join(directory, "reset.aacred")]);
  assert.equal((await call(alphaSession, "/api/me/avatar")).status, 401, "existing session is revoked");
  assert.equal((await login(alpha.username, newPasswords[alpha.username])).status, 401, "previous password no longer works");
  const [resetCredential] = readExport(join(directory, "reset.aacred"), passphrase);
  const recovered = await login(alpha.username, resetCredential.password);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.payload.user.mustChangePassword, true, "recovery forces a new password");
  cli(["reset", "--target", "local", "--username", admin.identity.username, "--verified-ref", "x1", "--export", join(directory, "nope.aacred")], { expectFailure: true });

  // ---- suspension and the student sign-in switch
  cli(["suspend", "--target", "local", "--username", bravo.username, "--reason", "fictional-ticket-2"]);
  assert.equal((await call(bravoSession, "/api/me/avatar")).status, 401, "suspension revokes sessions");
  assert.equal((await login(bravo.username, newPasswords[bravo.username])).status, 401);
  cli(["reactivate", "--target", "local", "--username", bravo.username, "--reason", "fictional-ticket-3"]);
  const bravoAgain = await login(bravo.username, newPasswords[bravo.username]);
  assert.equal(bravoAgain.status, 200);
  cli(["features", "--target", "local", "--set", "student_sign_in=off"]);
  try {
    assert.equal((await call(bravoAgain, "/api/me/avatar")).status, 401, "switching student sign-in off ends student sessions");
    assert.equal((await login(bravo.username, newPasswords[bravo.username])).status, 401, "students cannot sign in while switched off");
    assert.equal((await json(await api("/api/public/features"))).studentSignIn, false);
    assert.equal((await board(4)).rows.length, 10, "public rankings are unaffected");
    assert.equal((await call(admin, "/api/staff/leaderboards/history")).status, 200, "staff are unaffected");
  } finally {
    cli(["features", "--target", "local", "--set", "student_sign_in=on"]);
  }

  assert.deepEqual(await json(await call(admin, "/api/staff/leaderboards/withdraw", { method: "POST", body: {} })), { withdrawn: true });
});
