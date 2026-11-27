#!/usr/bin/env node
// Release B2 local end-to-end demonstration (fictional data, loopback only).
//
//   npm run supabase:start && npm run supabase:reset
//   node scripts/b2-local-demo.mjs /abs/path/outside/repo/credentials.json
//
// Starts scripts/local-live-preview.mjs (production build + Pages Functions +
// local Supabase), then, with nothing mocked:
//   1. an AAL2 admin publishes a fictional Week 5 ranking and verifies links;
//   2. student A signs in (browser 1), builds a custom character, saves it
//      with public display on, and cannot save an unearned cosmetic (UI) nor
//      equip it through a direct API call;
//   3. a signed-out visitor (browser 2) sees A's complete custom look;
//   4. the admin previews and grants verified rewards (idempotently);
//   5. A sees the unlock celebration, equips Champion items and saves;
//   6. the visitor's next load shows the complete updated character
//      (desktop and mobile).
// Screenshots: test-results/b2-demo/. Exits non-zero on any failed check.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as OTPAuth from "otpauth";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const credentialsFile = process.argv[2];
if (!credentialsFile || path.resolve(credentialsFile).startsWith(root)) {
  console.error("Pass a credentials file path outside the repository.");
  process.exit(2);
}
const base = "http://127.0.0.1:8789";
const shots = path.join(root, "test-results", "b2-demo");
mkdirSync(shots, { recursive: true });
const step = (text) => console.log(`\n▶ ${text}`);
const ok = (text) => console.log(`  ✓ ${text}`);
const feature = (name, value) => execFileSync(process.execPath,
  ["scripts/student-accounts.mjs", "features", "--target", "local", "--set", `${name}=${value}`], { cwd: root, stdio: "ignore" });

// ---- BFF client for the staff side (cookie + CSRF, same origin) ----
async function call(session, route, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (session) Object.assign(headers, { Cookie: session.cookie, "X-CSRF-Token": session.csrfToken });
  if (method !== "GET") headers.Origin = base;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  let payload = {};
  try { payload = await response.json(); } catch {}
  return { status: response.status, payload, response };
}
async function apiLogin(account) {
  const { status, payload, response } = await call(null, "/api/auth/login", { method: "POST", body: { username: account.username, password: account.password } });
  assert.equal(status, 200, `login ${account.role}`);
  return { cookie: (response.headers.get("set-cookie") || "").split(";", 1)[0], csrfToken: payload.csrfToken };
}

const preview = spawn(process.execPath, ["scripts/local-live-preview.mjs", credentialsFile], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
let browser;
try {
  // Wait for the live preview.
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(base + "/")).ok) break; } catch {}
    if (preview.exitCode !== null) throw new Error("local-live-preview exited early");
    await delay(500);
  }
  assert.ok(existsSync(credentialsFile), "fictional QA credentials were written");
  const [adminAccount, studentA, studentB] = JSON.parse(readFileSync(credentialsFile, "utf8"));
  feature("student_sign_in", "on");
  feature("avatar_personalization", "on");
  feature("character_studio_v2", "on");
  feature("cosmetic_rewards", "off");

  step("Staff: AAL2 admin publishes a fictional Week 5 ranking and verifies two links");
  const admin = await apiLogin(adminAccount);
  const enrollment = await call(admin, "/api/auth/mfa/enroll", { method: "POST", body: {} });
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(enrollment.payload.secret) }).generate();
  assert.equal((await call(admin, "/api/auth/mfa/verify", { method: "POST", body: { code } })).status, 200);
  const csv = readFileSync(path.join(root, "data/ranking-upload.example.csv"), "utf8");
  const draft = await call(admin, "/api/staff/leaderboards/drafts", { method: "POST", body: { academicYear: "2026-27", releaseLabel: "Week 5", csv } });
  const week5 = draft.payload.draft.id;
  assert.equal((await call(admin, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId: week5 } })).status, 200);
  const links = `level,rank,username\n4,1,${studentA.username}\n4,5,${studentB.username}\n`;
  assert.equal((await call(admin, "/api/staff/leaderboards/links/approve", { method: "POST", body: { publicationId: week5, csv: links } })).status, 200);
  ok("published Week 5 and verified links for Level 4 #1 (student A) and #5 (student B)");

  browser = await chromium.launch({ headless: true });
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const visitorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const student = await studentContext.newPage();
  const visitor = await visitorContext.newPage();
  const errors = [];
  for (const page of [student, visitor]) page.on("pageerror", (error) => errors.push(error.message));
  const ready = async (page) => {
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true", null, { timeout: 15000 });
    // Close the first-visit welcome message like a visitor would.
    if (await page.locator("#welcome-backdrop").isVisible()) await page.click("#welcome-close");
  };

  step("Browser 1: student A signs in and builds a custom character");
  await student.goto(base);
  await ready(student);
  await student.click("#account-entry");
  await student.fill("#login-username", studentA.username);
  await student.fill("#login-password", studentA.password);
  await student.click("#login-form button[type=submit]");
  await student.waitForFunction(() => document.documentElement.dataset.session === "student", null, { timeout: 15000 });
  await student.keyboard.press("Escape");
  await student.click("[data-page=avatar]");
  await student.waitForSelector("#studio-v2:not([hidden]) #v2-stage svg");
  await student.click("#v2-cat-body");
  await student.getByRole("button", { name: "Skin tone 9 of 12" }).click();
  await student.click("#v2-cat-hair");
  await student.getByRole("button", { name: "Box braids", exact: true }).click();
  await student.getByRole("button", { name: "Copper" }).click();
  await student.click("#v2-cat-glasses");
  await student.getByRole("button", { name: "Round", exact: true }).click();
  await student.click("#v2-cat-top");
  await student.getByRole("button", { name: "Track jacket", exact: true }).click();
  await student.getByRole("button", { name: "Navy" }).first().click();
  await student.check("#v2-show-public");
  await student.click("#v2-save");
  await student.waitForFunction(() => /Saved/.test(document.getElementById("v2-toast").textContent), null, { timeout: 10000 });
  await student.screenshot({ path: path.join(shots, "1-student-created.png") });
  ok("saved a custom look with public display on");

  step("Unearned cosmetics cannot be equipped (UI and direct API)");
  await student.click("#v2-tab-wardrobe");
  await student.click("[data-wfilter=locked]");
  await student.getByRole("button", { name: /^TRY ON Champion cape/ }).click();
  assert.equal(await student.locator("#v2-save").isDisabled(), true, "save is disabled while a locked item is tried on");
  await student.screenshot({ path: path.join(shots, "2-locked-try-on.png") });
  await student.click("#v2-undo");
  const directA = await apiLogin(studentA);
  const mine = (await call(directA, "/api/me/character")).payload;
  const bypass = await call(directA, "/api/me/character", { method: "PUT", body: {
    expectedRevision: mine.revision, activeLook: "v2", v2: { ...mine.v2, back: "cape", headwear: "laurel" }, showOnLeaderboard: true, showOnCampusWins: false } });
  assert.deepEqual([bypass.status, bypass.payload.error], [403, "item_not_owned"]);
  ok("UI blocks saving; a direct BFF call is refused with 403 item_not_owned (and the database refuses it again)");

  // Student B saves a custom look too (through the BFF), so the board shows two.
  const b = await apiLogin(studentB);
  const bState = (await call(b, "/api/me/character")).payload;
  const bLook = { v: 2, skin: "s03", face: "round", build: "soft", hair: "wavylong", hairColor: "h09", eyes: "upturned", eyeColor: "e07",
    brows: "arched", nose: "petite", mouth: "grin", facialHair: "none", blush: "rosy", liner: "wing", lips: "l02", details: ["freckles"],
    headwear: "draped", headwearColor: "c14", glasses: "none", glassesColor: "f01", hearing: "cochlear", mobility: "none", earrings: "studs",
    top: "abaya", topColor: "c13", bottom: "jeans", bottomColor: "c16", shoes: "flats", shoesColor: "c01",
    neck: "none", neckColor: "c05", back: "tote", backColor: "c07", backdrop: "campus", sticker: "book" };
  assert.equal((await call(b, "/api/me/character", { method: "PUT", body: { expectedRevision: bState.revision, activeLook: "v2", v2: bLook, showOnLeaderboard: true, showOnCampusWins: false } })).status, 200);

  step("Browser 2: a signed-out visitor sees student A's complete custom look");
  await visitor.goto(base);
  await ready(visitor);
  await visitor.waitForSelector(".champion-v2 svg");
  const before = await visitor.locator(".champion-v2 svg").first().innerHTML();
  assert.doesNotMatch(before, /-cape"/, "no cape yet");
  await visitor.screenshot({ path: path.join(shots, "3-visitor-before-reward.png") });
  ok("podium #1 is drawn by the shared renderer from A's saved config");

  step("Staff: verified rewards preview, then grant (twice: idempotent)");
  const previewed = (await call(admin, "/api/staff/rewards/preview", { method: "POST", body: { publicationId: week5, periodKey: "2026-27:week-05" } })).payload.preview;
  console.log(`  preview: elite +${previewed.collections.elite.newGrants}, podium +${previewed.collections.podium.newGrants}, champion +${previewed.collections.champion.newGrants}; unlinked rows ${previewed.exclusions.unlinked}; switch ${previewed.rewardsSwitchOn ? "on" : "off"}`);
  assert.equal((await call(admin, "/api/staff/rewards/process", { method: "POST", body: { publicationId: week5, periodKey: "2026-27:week-05", periodLabel: "Week 5", mode: "grant" } })).status, 409, "refused while the switch is off");
  feature("cosmetic_rewards", "on");
  const granted = (await call(admin, "/api/staff/rewards/process", { method: "POST", body: { publicationId: week5, periodKey: "2026-27:week-05", periodLabel: "Week 5", mode: "grant" } })).payload.result;
  const again = (await call(admin, "/api/staff/rewards/process", { method: "POST", body: { publicationId: week5, periodKey: "2026-27:week-05", periodLabel: "Week 5", mode: "grant" } })).payload.result;
  assert.deepEqual([granted.granted, again.granted], [4, 0]);
  ok("granted 4 (A: Elite+Podium+Champion, B: Elite); the retry granted 0");

  step("Browser 1: A sees the unlock, equips Champion items and saves");
  await student.reload();
  await ready(student);
  await student.click("[data-page=avatar]");
  await student.waitForSelector("#v2-celebrate:not([hidden])", { timeout: 10000 });
  await student.screenshot({ path: path.join(shots, "4-unlock-celebration.png") });
  await student.click("#v2-celebrate-open");
  for (const name of ["Champion cape", "Champion's laurel", "Champion hall", "Champion gold kicks", "Podium medal"]) {
    await student.getByRole("button", { name: `EQUIP ${name}` }).click();
  }
  await student.click("#v2-save");
  await student.waitForFunction(() => /Saved/.test(document.getElementById("v2-toast").textContent), null, { timeout: 10000 });
  await student.screenshot({ path: path.join(shots, "5-student-equipped.png") });
  ok("saved with earned items");

  step("Browser 2: the visitor's next load shows the complete updated character");
  await visitor.reload();
  await ready(visitor);
  await visitor.waitForSelector(".champion-v2 svg");
  const after = await visitor.locator(".champion-v2 svg").first().innerHTML();
  assert.match(after, /-cape"/, "the cape is on the public podium");
  await visitor.screenshot({ path: path.join(shots, "6-visitor-after-reward.png") });
  const mobile = await mobileContext.newPage();
  await mobile.goto(base);
  await ready(mobile);
  await mobile.waitForSelector(".champion-v2 svg");
  await mobile.screenshot({ path: path.join(shots, "7-visitor-mobile.png") });
  ok("desktop and mobile visitors see the earned look, with no staff re-approval");

  const publicBoard = (await call(null, "/api/public/leaderboards?level=4")).payload;
  assert.doesNotMatch(JSON.stringify(publicBoard), /qa-|username|account|email|revision|owned|grant/iu, "the public API carries no private data");
  assert.deepEqual(errors, []);
  feature("cosmetic_rewards", "off");
  console.log(`\nPASS: B2 local two-browser demonstration. Screenshots in ${path.relative(root, shots)}/`);
} catch (error) {
  console.error(`\nFAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
  await delay(1500);
}
