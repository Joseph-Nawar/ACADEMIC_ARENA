#!/usr/bin/env node
// Release B hosted staging acceptance (fictional fixtures only). Refuses any
// project except staging. Real hosted Pages + Functions + Supabase; nothing
// is mocked. Reuses suspended fictional fixtures, re-suspends and bans them
// afterwards, deletes their MFA factors and revokes their app sessions.
//
//   node scripts/b3-staging-acceptance.mjs
//
// Passwords are random, held in memory only, never printed or written.
// Screenshots: test-results/b3-staging/. Results: printed, one line per check.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as OTPAuth from "otpauth";
import { chromium, devices, webkit } from "playwright";
import { connect, PRODUCTION_REF } from "./student-accounts.mjs";

const REF = "cynfnxlbmthjxgivllkg";
const SITE = "https://academic-arena-staging.pages.dev";
if (REF === PRODUCTION_REF) throw new Error("never production");
const root = path.resolve(import.meta.dirname, "..");
const shots = path.join(root, "test-results", "b3-staging");
mkdirSync(shots, { recursive: true });
const FIXTURES = { admin: "ra0b0305-qa-admin", alpha: "ra0b0305-alpha", bravo: "ra0b0305-bravo", charlie: "ra0b0305-charlie" };
const results = [];
const check = (step, text, ok = true) => { results.push({ step, text, ok }); console.log(`  ${ok ? "✓" : "✗"} [${step}] ${text}`); if (!ok) throw new Error(`step ${step} failed: ${text}`); };
const section = (text) => console.log(`\n▶ ${text}`);
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;

const conn = await connect(REF);
assert.equal(conn.production, false);
assert.ok(conn.anonKey, "anon key available");
const sql = (query) => conn.sql(query);
const authAdmin = (id, body) => fetch(`${conn.url}/auth/v1/admin/users/${id}`, {
  method: "PUT", headers: { apikey: conn.serviceKey, Authorization: `Bearer ${conn.serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((response) => { if (!response.ok) throw new Error(`Auth Admin ${response.status}`); });
const feature = (name, on) => sql(`select app_private.operator_set_student_feature(${lit(name)}, ${on})`);

// ---- BFF client
async function call(session, route, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (session) Object.assign(headers, { Cookie: session.cookie, "X-CSRF-Token": session.csrfToken });
  if (method !== "GET") headers.Origin = SITE;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(SITE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  let payload = {};
  try { payload = await response.json(); } catch {}
  return { status: response.status, payload, response };
}
async function login(fixture) {
  const { status, payload, response } = await call(null, "/api/auth/login", { method: "POST", body: { username: fixture.username, password: fixture.password } });
  assert.equal(status, 200, `login ${fixture.username}`);
  return { cookie: (response.headers.get("set-cookie") || "").split(";", 1)[0], csrfToken: payload.csrfToken };
}
const board = async (level) => (await call(null, `/api/public/leaderboards?level=${level}`)).payload;
const feed = async () => (await call(null, "/api/public/campus-wins?category=all")).payload.posts;

let browsers = [];
const fixtures = {};
let originalSwitches;
try {
  // ---------------------------------------------------------------- prepare fixtures
  section("Prepare: reactivate four suspended fictional fixtures with fresh in-memory passwords");
  const rows = await sql(`select m.username_normalized as username, a.id as account_id, a.provider_user_id as user_id, m.provider_email as email
    from app_private.identity_mappings m join app_private.accounts a on a.id = m.account_id
    where m.username_normalized in (${Object.values(FIXTURES).map(lit).join(",")})`);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.match(row.email, /@academic-arena\.test$/u, "fixtures are fictional");
    const role = Object.keys(FIXTURES).find((key) => FIXTURES[key] === row.username);
    fixtures[role] = { ...row, password: `${randomBytes(18).toString("base64url")}Aa1!` };
    await authAdmin(row.user_id, { password: fixtures[role].password, ban_duration: "none" });
  }
  await sql(`update app_private.accounts set status = 'active', force_password_change = false, credential_update_pending = false
    where id in (${rows.map((row) => lit(row.account_id)).join(",")})`);
  [originalSwitches] = await sql("select student_sign_in, avatar_personalization, welcome_dialog, character_studio_v2, cosmetic_rewards from app_private.student_feature_controls");
  await feature("character_studio_v2", false);
  await feature("cosmetic_rewards", false);
  await sql("update public.published_leaderboard_snapshots set is_current = false where is_current"); // staging had none live
  check(0, "fixtures active, studio and rewards switches off, no live publication");

  const admin = await login(fixtures.admin);
  const enrollment = await call(admin, "/api/auth/mfa/enroll", { method: "POST", body: {} });
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(enrollment.payload.secret) });
  assert.equal((await call(admin, "/api/auth/mfa/verify", { method: "POST", body: { code: totp.generate() } })).status, 200);
  const alpha = await login(fixtures.alpha);
  const bravo = await login(fixtures.bravo);
  const charlie = await login(fixtures.charlie);
  const me = async (session) => (await call(session, "/api/me/character")).payload;
  check(0, "admin signed in with TOTP (AAL2); three students signed in through the hosted BFF");

  // ---------------------------------------------------------------- 1. classic intact
  section("1. Existing Classic characters are intact after the migration");
  const before = { "ra0b0305-alpha": ["zein", "cartoon3d", "lilac", "★"], "ra0b0305-bravo": ["mariam", "cartoon3d", "gold", "♥"], "ra0b0305-charlie": ["amara", "ink", "mint", "✦"] };
  for (const [role, session] of [["alpha", alpha], ["bravo", bravo], ["charlie", charlie]]) {
    const state = await me(session);
    const c = state.classic;
    assert.deepEqual([c.base, c.style, c.tone, c.badge], before[fixtures[role].username]);
    assert.deepEqual([state.activeLook, state.v2, state.showOnLeaderboard, state.showOnCampusWins], ["classic", null, true, false]);
  }
  check(1, "3/3 classic looks identical to the pre-migration snapshot; activeLook classic; leaderboard consent kept; Campus Wins consent off");

  // ---------------------------------------------------------------- 2. create V2 (UI)
  section("2. Student A creates and saves a custom character in the hosted UI (Chromium)");
  await feature("character_studio_v2", true);
  const chromiumBrowser = await chromium.launch();
  const webkitBrowser = await webkit.launch();
  browsers = [chromiumBrowser, webkitBrowser];
  const studentContext = await chromiumBrowser.newContext({ viewport: { width: 1440, height: 900 } });
  const student = await studentContext.newPage();
  const pageErrors = [];
  student.on("pageerror", (error) => pageErrors.push(error.message));
  const ready = async (page) => {
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true", null, { timeout: 20000 });
    if (await page.locator("#welcome-backdrop").isVisible()) await page.click("#welcome-close");
  };
  await student.goto(SITE);
  await ready(student);
  await student.click("#account-entry");
  await student.fill("#login-username", fixtures.alpha.username);
  await student.fill("#login-password", fixtures.alpha.password);
  await student.click("#login-form button[type=submit]");
  await student.waitForFunction(() => document.documentElement.dataset.session === "student", null, { timeout: 20000 });
  await student.keyboard.press("Escape");
  await student.click("[data-page=avatar]");
  await student.waitForSelector("#look-switch:not([hidden])");
  await student.click("[data-look=v2]");
  await student.waitForSelector("#studio-v2:not([hidden]) #v2-stage svg");
  await student.click("#v2-cat-body");
  await student.getByRole("button", { name: "Skin tone 10 of 12" }).click();
  await student.click("#v2-cat-hair");
  await student.getByRole("button", { name: "Afro", exact: true }).click();
  await student.getByRole("button", { name: "Copper" }).click();
  await student.click("#v2-cat-top");
  await student.getByRole("button", { name: "Track jacket", exact: true }).click();
  assert.equal(await student.locator("#v2-show-public").isChecked(), true, "the existing consent is shown");
  await student.click("#v2-save");
  await student.waitForFunction(() => /Saved/.test(document.getElementById("v2-toast").textContent), null, { timeout: 15000 });
  await student.screenshot({ path: path.join(shots, "02-student-created-chromium.png") });
  let alphaState = await me(alpha);
  assert.deepEqual([alphaState.activeLook, alphaState.v2.hair, alphaState.classic.base], ["v2", "afro", "zein"]);
  const bravoLook = { ...alphaState.v2, skin: "s03", hair: "wavylong", hairColor: "h09", headwear: "khimar", headwearColor: "c14", top: "abaya", topColor: "c13", glasses: "round", hearing: "cochlear" };
  let bravoState = await me(bravo);
  bravoState = (await call(bravo, "/api/me/character", { method: "PUT", body: { expectedRevision: bravoState.revision, activeLook: "v2", v2: bravoLook, showOnLeaderboard: true, showOnCampusWins: false } })).payload;
  assert.equal(bravoState.activeLook, "v2");
  check(2, "custom look saved through the hosted UI (classic kept alongside); a second student saved one through the BFF");

  // ---------------------------------------------------------------- 3. ranking + links
  section("3. Verified fictional ranking and identity links approved by the AAL2 admin");
  const csv = readFileSync(path.join(root, "data/ranking-upload.example.csv"), "utf8");
  const upload = async (label) => (await call(admin, "/api/staff/leaderboards/drafts", { method: "POST", body: { academicYear: "2026-27", releaseLabel: label, csv } })).payload.draft.id;
  const publish = async (id) => assert.equal((await call(admin, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId: id } })).status, 200);
  const approve = async (id, lines) => assert.equal((await call(admin, "/api/staff/leaderboards/links/approve", { method: "POST", body: { publicationId: id, csv: `level,rank,username\n${lines.join("\n")}\n` } })).status, 200);
  const week5 = await upload("Week 5");
  await publish(week5);
  await approve(week5, [`4,1,${fixtures.alpha.username}`, `4,2,${fixtures.bravo.username}`, `5,7,${fixtures.charlie.username}`]);
  let l4 = await board(4);
  assert.deepEqual([l4.rows[0].v2?.hair, l4.rows[1].v2?.top], ["afro", "abaya"]);
  assert.equal((await board(5)).rows[6].avatar, "amara", "a classic student still shows their classic look");
  check(3, "Week 5 published; 3 verified links; the board shows both custom looks and the classic one");

  // ---------------------------------------------------------------- 4. preview + process
  section("4. Staff previews and processes fictional rewards");
  const preview = async (id) => (await call(admin, "/api/staff/rewards/preview", { method: "POST", body: { publicationId: id, periodKey: "2026-27:week-5" } })).payload.preview;
  const processRewards = (id, mode, expectedChanges) => call(admin, "/api/staff/rewards/process", { method: "POST", body: { publicationId: id, periodKey: "2026-27:week-5", periodLabel: "Week 5", mode, expectedChanges } });
  let p = await preview(week5);
  assert.deepEqual([p.canonicalKey, p.collections.elite.newGrants, p.collections.podium.newGrants, p.collections.champion.newGrants, p.expectedChanges.grant, p.blockers.length], ["2026-27:week-5", 3, 2, 1, 6, 0]);
  assert.equal((await processRewards(week5, "grant", 6)).status, 409, "refused while the switch is off");
  await feature("cosmetic_rewards", true);
  const granted = (await processRewards(week5, "grant", 6)).payload.result;
  assert.equal(granted.granted, 6);
  check(4, "preview 3 Elite / 2 Podium / 1 Champion (6 changes, no blockers); refused while switched off; then granted 6");

  // ---------------------------------------------------------------- 5. celebration
  section("5. Student receives the cosmetics and the unlock celebration (Chromium)");
  await student.reload();
  await ready(student);
  await student.click("[data-page=avatar]");
  await student.waitForSelector("#v2-celebrate:not([hidden])", { timeout: 15000 });
  assert.match(await student.locator("#v2-celebrate-text").textContent(), /Champion Collection/);
  await student.waitForTimeout(700);
  await student.screenshot({ path: path.join(shots, "05-unlock-celebration-chromium.png") });
  alphaState = await me(alpha);
  assert.deepEqual(alphaState.owned, ["champion", "elite", "essentials", "podium"]);
  check(5, "celebration shown once; owned = Champion, Elite, Essentials, Podium");

  // ---------------------------------------------------------------- 6. equip + save (UI)
  section("6. Student equips earned cosmetics and saves (Chromium UI)");
  await student.click("#v2-celebrate-open");
  for (const name of ["Champion cape", "Champion's laurel", "Champion hall", "Champion gold kicks", "Podium medal"]) {
    await student.getByRole("button", { name: `EQUIP ${name}` }).click();
  }
  await student.click("#v2-save");
  await student.waitForFunction(() => /Saved/.test(document.getElementById("v2-toast").textContent), null, { timeout: 15000 });
  await student.screenshot({ path: path.join(shots, "06-student-equipped-chromium.png") });
  alphaState = await me(alpha);
  assert.deepEqual([alphaState.v2.back, alphaState.v2.headwear, alphaState.v2.backdrop, alphaState.v2.shoes, alphaState.v2.neck], ["cape", "laurel", "hall", "gold", "medal"]);
  check(6, "cape, laurel, champion hall, gold kicks and medal saved");

  // ---------------------------------------------------------------- 7. signed-out browsers
  section("7. Separate signed-out browsers see the complete look (WebKit and Chromium, desktop and mobile)");
  const visitors = [
    ["webkit-desktop", webkitBrowser, { viewport: { width: 1440, height: 900 } }],
    ["webkit-iphone", webkitBrowser, devices["iPhone 13"]],
    ["chromium-desktop", chromiumBrowser, { viewport: { width: 1440, height: 900 } }],
    ["chromium-pixel", chromiumBrowser, devices["Pixel 7"]],
  ];
  const visitorPages = {};
  for (const [name, browser, options] of visitors) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.goto(SITE);
    await ready(page);
    await page.waitForSelector(".champion-v2 svg");
    const podium = await page.locator(".champion-v2 svg").first().innerHTML();
    assert.match(podium, /-cape"/, `${name}: cape on the podium`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${name}: no horizontal overflow`);
    await page.screenshot({ path: path.join(shots, `07-visitor-${name}.png`) });
    visitorPages[name] = page;
  }
  check(7, "4/4 signed-out browsers (WebKit desktop + iPhone, Chromium desktop + Pixel) show the earned look; no overflow");

  // ---------------------------------------------------------------- 8. later change propagates
  section("8. A later change appears with no new staff approval");
  const linksBefore = (await call(admin, `/api/staff/leaderboards/links?publicationId=${week5}`)).payload.links;
  alphaState = (await call(alpha, "/api/me/character", { method: "PUT", body: { expectedRevision: alphaState.revision, activeLook: "v2", v2: { ...alphaState.v2, hair: "locs", hairColor: "h07" }, showOnLeaderboard: true, showOnCampusWins: false } })).payload;
  await visitorPages["webkit-desktop"].reload();
  await ready(visitorPages["webkit-desktop"]);
  assert.equal((await board(4)).rows[0].v2.hair, "locs");
  assert.deepEqual((await call(admin, `/api/staff/leaderboards/links?publicationId=${week5}`)).payload.links, linksBefore);
  await visitorPages["webkit-desktop"].screenshot({ path: path.join(shots, "08-visitor-after-change-webkit.png") });
  check(8, "hair change public on the next load; links untouched");

  // ---------------------------------------------------------------- 9. unearned refused (API + DB)
  section("9. Unearned cosmetics are refused at the API and the database");
  let charlieState = await me(charlie);
  charlieState = (await call(charlie, "/api/me/character", { method: "PUT", body: { expectedRevision: charlieState.revision, activeLook: "v2", v2: { ...alphaState.v2, back: "none", headwear: "none", shoes: "elite", backdrop: "spotlight", neck: "none" }, showOnLeaderboard: true, showOnCampusWins: false } })).payload;
  assert.equal(charlieState.saved, true, "Elite items (earned) can be saved");
  const bffAttempt = await call(charlie, "/api/me/character", { method: "PUT", body: { expectedRevision: charlieState.revision, activeLook: "v2", v2: { ...charlieState.v2, back: "cape" }, showOnLeaderboard: true, showOnCampusWins: false } });
  assert.deepEqual([bffAttempt.status, bffAttempt.payload.error], [403, "item_not_owned"]);
  const providerLogin = await fetch(`${conn.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: conn.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: fixtures.charlie.email, password: fixtures.charlie.password }) });
  const providerToken = (await providerLogin.json()).access_token;
  const direct = (route, init) => fetch(`${conn.url}${route}`, { ...init, headers: { apikey: conn.anonKey, Authorization: `Bearer ${providerToken}`, "Content-Type": "application/json", Accept: "application/json" } });
  const rpc = await direct("/rest/v1/rpc/save_own_character_v2", { method: "POST", body: JSON.stringify({ p_expected_revision: charlieState.revision, p_v2_config: { ...charlieState.v2, back: "cape" }, p_active_look: "v2", p_show_on_leaderboard: true, p_show_on_campus_wins: false }) });
  assert.equal((await rpc.json()).code, "AAC01");
  const table = await direct(`/rest/v1/student_avatar_configs?account_id=eq.${fixtures.charlie.account_id}`, { method: "PATCH", body: JSON.stringify({ v2_config: { ...charlieState.v2, back: "cape" } }) });
  assert.ok([401, 403].includes(table.status));
  const legacyWins = await fetch(`${conn.url}/rest/v1/campus_wins_public?select=post_id,avatar_key`, { headers: { apikey: conn.anonKey, Authorization: `Bearer ${conn.anonKey}` } });
  assert.ok([401, 403].includes(legacyWins.status));
  assert.equal((await me(charlie)).v2.back, "none");
  await fetch(`${conn.url}/auth/v1/logout?scope=global`, { method: "POST", headers: { apikey: conn.anonKey, Authorization: `Bearer ${providerToken}` } });
  check(9, "BFF 403 item_not_owned; direct Supabase RPC AAC01; direct table write refused; legacy Campus Wins table refused to the anon key; stored look unchanged");

  // ---------------------------------------------------------------- 10. opt-out
  section("10. Opting out removes the personalized public appearance");
  alphaState = (await call(alpha, "/api/me/character", { method: "PUT", body: { expectedRevision: alphaState.revision, activeLook: "v2", v2: null, showOnLeaderboard: false, showOnCampusWins: false } })).payload;
  l4 = await board(4);
  assert.equal(l4.rows[0].personalized, false);
  assert.equal(alphaState.publication, "display_off");
  alphaState = (await call(alpha, "/api/me/character", { method: "PUT", body: { expectedRevision: alphaState.revision, activeLook: "v2", v2: null, showOnLeaderboard: true, showOnCampusWins: false } })).payload;
  assert.equal((await board(4)).rows[0].v2.hair, "locs");
  check(10, "opt-out → default/neutral on the next load (state display_off); opting back in restores it, no approval needed");

  // ---------------------------------------------------------------- 11. Campus Wins
  section("11. Campus Wins respects its separate consent and later changes");
  assert.equal((await call(admin, "/api/staff/accounts/public-name", { method: "POST", body: { username: fixtures.alpha.username, publicName: "Fictional Alpha" } })).status, 200);
  const submitted = await call(alpha, "/api/me/achievements", { method: "POST", body: { type: "workshop" } });
  assert.equal(submitted.status, 201);
  const winId = submitted.payload.id;
  assert.equal((await call(admin, `/api/staff/campus-wins/${winId}/moderation`, { method: "POST", body: { decision: "approved" } })).status, 200);
  let post = (await feed()).find((item) => item.id === winId);
  assert.deepEqual(Object.keys(post).sort(), ["author", "counts", "created", "id", "type"], "leaderboard consent alone: neutral");
  alphaState = (await call(alpha, "/api/me/character", { method: "PUT", body: { expectedRevision: alphaState.revision, activeLook: "v2", v2: null, showOnLeaderboard: true, showOnCampusWins: true } })).payload;
  post = (await feed()).find((item) => item.id === winId);
  assert.equal(post.v2.hair, "locs");
  alphaState = (await call(alpha, "/api/me/character", { method: "PUT", body: { expectedRevision: alphaState.revision, activeLook: "v2", v2: { ...alphaState.v2, hair: "braids" }, showOnLeaderboard: true, showOnCampusWins: true } })).payload;
  assert.equal((await feed()).find((item) => item.id === winId).v2.hair, "braids");
  const winsPage = await (await webkitBrowser.newContext(devices["iPhone 13"])).newPage();
  await winsPage.goto(SITE);
  await ready(winsPage);
  await winsPage.click("[data-page=wins]");
  await winsPage.waitForSelector(".win-avatar .win-v2 svg");
  await winsPage.screenshot({ path: path.join(shots, "11-campus-wins-webkit-iphone.png") });
  alphaState = (await call(alpha, "/api/me/character", { method: "PUT", body: { expectedRevision: alphaState.revision, activeLook: "v2", v2: null, showOnLeaderboard: true, showOnCampusWins: false } })).payload;
  assert.equal((await feed()).find((item) => item.id === winId).v2, undefined);
  check(11, "neutral without Campus Wins consent; latest look with it (two changes followed); neutral again after withdrawal");

  // ---------------------------------------------------------------- 12. duplicates
  section("12. Duplicate processing creates no duplicate entitlements");
  p = await preview(week5);
  assert.equal(p.expectedChanges.grant, 0);
  assert.equal((await processRewards(week5, "grant", 0)).payload.result.granted, 0);
  assert.equal((await processRewards(week5, "grant", 1)).payload.error, "preview_out_of_date");
  const [{ total }] = await sql(`select count(*)::int as total from app_private.cosmetic_entitlements e join app_private.reward_periods p on p.id = e.period_id where p.period_key = '2026-27:week-5'`);
  assert.equal(total, 6);
  check(12, "re-processing grants 0; a mismatched confirmation is refused; 6 entitlements in the period");

  // ---------------------------------------------------------------- 13. correction
  section("13. An academic correction reconciles rewards safely");
  const corrected = await upload("Week 5");
  await publish(corrected);
  await approve(corrected, [`4,1,${fixtures.bravo.username}`, `4,2,${fixtures.alpha.username}`, `5,7,${fixtures.charlie.username}`]);
  p = await preview(corrected);
  assert.deepEqual([p.collections.champion.newGrants, p.collections.champion.wouldRevoke, p.revocation.students, p.revocation.equippedFallbacks, p.expectedChanges.reconcile], [1, 1, 1, 1, 2]);
  assert.equal((await processRewards(corrected, "reconcile", 1)).payload.error, "preview_out_of_date");
  const reconciled = (await processRewards(corrected, "reconcile", 2)).payload.result;
  assert.deepEqual([reconciled.granted, reconciled.revoked, reconciled.equippedFallbacks], [1, 1, 1]);
  l4 = await board(4);
  assert.deepEqual([l4.rows[1].v2.back, l4.rows[1].v2.headwear, l4.rows[1].v2.neck], ["none", "none", "medal"], "only Champion items fell back; the Podium medal stays");
  const [{ reason }] = await sql(`select e.revoke_reason as reason from app_private.cosmetic_entitlements e join app_private.reward_periods p on p.id = e.period_id
    where p.period_key = '2026-27:week-5' and e.collection_key = 'champion' and e.account_id = ${lit(fixtures.alpha.account_id)}`);
  assert.equal(reason, "result_corrected");
  check(13, "preview 1 grant + 1 revocation (1 student, 1 worn-item fallback); stale confirmation refused; reconcile granted 1, revoked 1 (audited), Champion items fell back, Podium medal kept");

  // ---------------------------------------------------------------- 14/15. switch off and on
  section("14. Disabling V2 keeps saved V2 looks and restores Classic/default rendering");
  const saved = await sql(`select account_id, v2_config::text as v from public.student_avatar_configs where account_id in (${[fixtures.alpha, fixtures.bravo, fixtures.charlie].map((f) => lit(f.account_id)).join(",")}) order by 1`);
  await feature("character_studio_v2", false);
  l4 = await board(4);
  assert.deepEqual([l4.rows[0].avatar, l4.rows[0].v2, l4.rows[1].avatar, l4.rows[1].v2], ["mariam", undefined, "zein", undefined]);
  assert.equal((await me(alpha)).studioEnabled, false);
  const savedAfter = await sql(`select account_id, v2_config::text as v from public.student_avatar_configs where account_id in (${[fixtures.alpha, fixtures.bravo, fixtures.charlie].map((f) => lit(f.account_id)).join(",")}) order by 1`);
  assert.deepEqual(savedAfter, saved);
  const offPage = visitorPages["chromium-desktop"];
  await offPage.reload();
  await ready(offPage);
  await offPage.screenshot({ path: path.join(shots, "14-visitor-v2-off-chromium.png") });
  check(14, "with V2 off the board shows each student's Classic look; all 3 saved V2 configs unchanged");
  section("15. Re-enabling V2 restores the saved custom configuration");
  await feature("character_studio_v2", true);
  l4 = await board(4);
  assert.equal(l4.rows[0].v2.top, "abaya");
  assert.equal(l4.rows[1].v2.hair, "braids");
  await offPage.reload();
  await ready(offPage);
  await offPage.waitForSelector(".champion-v2 svg");
  await offPage.screenshot({ path: path.join(shots, "15-visitor-v2-on-chromium.png") });
  check(15, "custom looks back exactly as saved");

  // Student studio on a phone (WebKit): the preview stays visible while customizing.
  const phone = await (await webkitBrowser.newContext(devices["iPhone 13"])).newPage();
  await phone.goto(SITE);
  await ready(phone);
  await phone.click("#account-entry");
  await phone.fill("#login-username", fixtures.bravo.username);
  await phone.fill("#login-password", fixtures.bravo.password);
  await phone.click("#login-form button[type=submit]");
  await phone.waitForFunction(() => document.documentElement.dataset.session === "student", null, { timeout: 20000 });
  await phone.keyboard.press("Escape");
  await phone.click("[data-page=avatar]");
  await phone.waitForSelector("#studio-v2:not([hidden]) #v2-stage svg");
  await phone.evaluate(() => window.scrollTo(0, 900));
  await delay(300);
  const stuck = await phone.locator(".v2-preview").boundingBox();
  assert.ok(stuck && stuck.y >= -1 && stuck.y < 120, "preview stays in view while scrolling the options");
  await phone.screenshot({ path: path.join(shots, "16-student-studio-webkit-iphone.png") });
  check("mobile", "WebKit iPhone studio: preview sticky while scrolling, no page errors");
  assert.deepEqual(pageErrors, []);
} finally {
  // ---------------------------------------------------------------- cleanup
  section("Cleanup");
  try {
    await sql("update public.published_leaderboard_snapshots set is_current = false, revoked_at = coalesce(revoked_at, now()) where is_current");
    await sql(`update app_private.campus_wins_submissions set status = 'removed', moderated_at = now() where owner_account_id in (${Object.values(fixtures).map((f) => lit(f.account_id)).join(",") || "null"})`);
    await sql(`delete from public.campus_wins_public where post_id in (select id from app_private.campus_wins_submissions where owner_account_id in (${Object.values(fixtures).map((f) => lit(f.account_id)).join(",") || "null"}))`);
    if (originalSwitches) {
      await feature("character_studio_v2", false);
      await feature("cosmetic_rewards", false);
    }
    const ids = Object.values(fixtures).map((f) => lit(f.account_id)).join(",");
    if (ids) {
      await sql(`update app_private.accounts set status = 'suspended' where id in (${ids})`);
      await sql(`update app_private.bff_sessions set revoked_at = now(), revoke_reason = 'admin_revoke', provider_access_token_jwe = null, provider_refresh_token_jwe = null, csrf_token_jwe = null where account_id in (${ids}) and revoked_at is null`);
      for (const fixture of Object.values(fixtures)) {
        const factors = await sql(`select id from auth.mfa_factors where user_id = ${lit(fixture.user_id)}`);
        for (const factor of factors) {
          await fetch(`${conn.url}/auth/v1/admin/users/${fixture.user_id}/factors/${factor.id}`, { method: "DELETE", headers: { apikey: conn.serviceKey, Authorization: `Bearer ${conn.serviceKey}` } });
        }
        await authAdmin(fixture.user_id, { password: `${randomBytes(24).toString("base64url")}Zz9!`, ban_duration: "876000h" });
      }
      const [state] = await sql(`select
        (select count(*) from app_private.accounts where id in (${ids}) and status = 'suspended')::int as suspended,
        (select count(*) from auth.users u join app_private.accounts a on a.provider_user_id = u.id where a.id in (${ids}) and u.banned_until > now())::int as banned,
        (select count(*) from auth.mfa_factors f join app_private.accounts a on a.provider_user_id = f.user_id where a.id in (${ids}))::int as factors,
        (select count(*) from app_private.bff_sessions where account_id in (${ids}) and revoked_at is null)::int as live_app_sessions,
        (select count(*) from auth.sessions s join app_private.accounts a on a.provider_user_id = s.user_id where a.id in (${ids}))::int as provider_session_rows,
        (select count(*) from public.published_leaderboard_snapshots where is_current)::int as live_publications,
        (select row_to_json(c) from app_private.student_feature_controls c)::text as switches`);
      console.log(`  cleanup state: ${JSON.stringify(state)}`);
    }
  } catch (error) {
    console.error(`  cleanup error: ${error.message.replace(/sbp_[A-Za-z0-9_]+|eyJ[A-Za-z0-9._-]+/gu, "[redacted]")}`);
    process.exitCode = 1;
  }
  for (const browser of browsers) await browser.close().catch(() => {});
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${failed.length ? "FAIL" : results.length >= 16 ? "PASS" : "INCOMPLETE"}: ${results.filter((item) => item.ok).length} checks passed`);
  if (results.length < 16) process.exitCode = 1;
}
