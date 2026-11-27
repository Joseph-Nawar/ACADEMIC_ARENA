// Release B2 in the production build against a scripted BFF (fictional data):
// the server-backed studio (load, classic kept, celebrate a real grant once,
// equip an owned item, save with the base revision, conflict and ownership
// errors keep edits, locked items cannot be saved), Campus Wins neutral and V2
// figures, and sign-out with a late response in flight. Plus the Staff Desk
// regression for the B1 initialization race (staff.js loading after the first
// session event) and the rewards panel.
import assert from "node:assert/strict";
import { join } from "node:path";

const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.appReady === "true", null, { timeout: 8000 });
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const today = new Date().toISOString().slice(0, 10);

function v2Look(changes = {}) {
  return { v: 2, skin: "s07", face: "oval", build: "regular", hair: "braids", hairColor: "h01", eyes: "almond", eyeColor: "e02",
    brows: "soft", nose: "button", mouth: "smile", facialHair: "none", blush: "none", liner: "none", lips: "none", details: [],
    headwear: "none", headwearColor: "c11", glasses: "round", glassesColor: "f01", hearing: "none", mobility: "none", earrings: "none",
    top: "hoodie", topColor: "c11", bottom: "jeans", bottomColor: "c16", shoes: "sneakers", shoesColor: "c03",
    neck: "none", neckColor: "c05", back: "none", backColor: "c05", backdrop: "mint", sticker: "spark", ...changes };
}

export async function runCharacterServerTests(browser, baseUrl, root) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const server = {
    signedIn: true, revision: 3, activeLook: "classic", classic: { base: "tariq", style: "ink", tone: "coral", badge: "⚡" }, v2: null,
    owned: ["champion", "elite", "essentials", "podium"], grants: [{ collection: "champion", period: "Week 5", grantedAt: today }],
    showOnLeaderboard: true, showOnCampusWins: false, publication: "public",
  };
  const puts = [];
  let nextPutError = null;
  let holdCharacterGet = null;
  const state = () => ({ saved: true, activeLook: server.activeLook, revision: server.revision, classic: server.classic, v2: server.v2,
    showOnLeaderboard: server.showOnLeaderboard, showOnCampusWins: server.showOnCampusWins, studioEnabled: true,
    owned: server.owned, grants: server.grants, publication: server.publication });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;
    if (path === "/api/public/features") return json(route, 200, { studentSignIn: true, avatarPersonalization: true, welcomeDialog: false, characterStudioV2: true });
    if (path === "/api/auth/session") return server.signedIn
      ? json(route, 200, { authenticated: true, csrfToken: "x".repeat(43), user: { role: "student", mustChangePassword: false } })
      : json(route, 401, { error: "unauthorized" });
    if (path === "/api/auth/logout") { server.signedIn = false; return json(route, 200, { signedOut: true }); }
    if (path === "/api/me/avatar") return json(route, 200, { avatar: server.classic, showOnLeaderboard: server.showOnLeaderboard, publication: server.publication });
    if (path === "/api/me/character" && method === "GET") {
      if (holdCharacterGet) await holdCharacterGet.promise;
      return server.signedIn ? json(route, 200, state()) : json(route, 401, { error: "unauthorized" });
    }
    if (path === "/api/me/character" && method === "PUT") {
      const body = JSON.parse(route.request().postData());
      puts.push(body);
      if (nextPutError) { const [status, error] = nextPutError; nextPutError = null; return json(route, status, { error }); }
      if (body.expectedRevision !== server.revision) return json(route, 409, { error: "character_changed" });
      server.revision += 1;
      server.v2 = body.v2 ?? server.v2;
      server.activeLook = body.activeLook;
      server.showOnLeaderboard = body.showOnLeaderboard;
      server.showOnCampusWins = body.showOnCampusWins;
      return json(route, 200, state());
    }
    if (path === "/api/me/achievements") return json(route, 200, { submissions: [] });
    if (path === "/api/me/campus-win-reactions") return json(route, 200, { reactions: {} });
    if (path === "/api/public/leaderboards") return json(route, 200, { releaseLabel: "Week 5", publishedAt: today, rows: [
      { position: 1, name: "Fictional Leader", v2: server.v2 ?? v2Look(), personalized: true },
      { position: 2, name: "Fictional Second", avatar: "omar", personalized: false },
      { position: 3, name: "Fictional Third", personalized: false },
    ] });
    if (path === "/api/public/campus-wins") return json(route, 200, { posts: [
      { id: "11111111-1111-4111-8111-111111111111", author: "Fictional Private", type: "workshop", created: "27 Nov", counts: [1, 0, 0] },
      { id: "22222222-2222-4222-8222-222222222222", author: "Fictional Consented", type: "project", created: "27 Nov", counts: [0, 2, 0], v2: v2Look({ hair: "afro", headwear: "wrap" }) },
    ] });
    return json(route, 404, { error: "not_found" });
  });

  await page.goto(baseUrl);
  await ready(page);
  await page.click("[data-page=avatar]");
  // The verified grant is celebrated once; the classic look is the one shown.
  await page.waitForSelector("#v2-celebrate:not([hidden])");
  assert.match(await page.locator("#v2-celebrate-text").textContent(), /Champion Collection/);
  await page.keyboard.press("Escape");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("arena-v2-seen-grants"))), ["champion:Week 5"]);
  await page.click("[data-look=classic]");
  assert.equal(await page.locator("#studio-classic").isVisible(), true, "a classic student keeps their classic studio");
  assert.match(await page.locator("#look-switch-note").textContent(), /classic look is the one shown/);
  await page.click("[data-look=v2]");
  assert.equal(await page.locator("#v2-dirty").textContent(), "● NOT SAVED YET");
  assert.equal(await page.locator("#v2-public-state-label").textContent(), "PUBLIC NOW", "the status line is the server's");
  assert.equal(await page.locator("#v2-show-public").isChecked(), true, "the existing leaderboard consent is kept");
  assert.equal(await page.locator("#v2-show-wins").isChecked(), false, "Campus Wins consent is separate");

  // Locked: the requirement is written on the item, and it cannot be saved.
  await page.click("#v2-cat-top");
  const hoodie = page.getByRole("button", { name: /^Circuit hoodie \(locked: Arena Pass reward/ });
  assert.equal(await hoodie.locator(".v2-unlock-tag").textContent(), "ARENA PASS");
  await hoodie.click();
  assert.equal(await page.locator("#v2-save").isDisabled(), true);
  assert.match(await page.locator("#v2-locked-note").textContent(), /Circuit hoodie \(Arena Pass reward/);
  await page.click("#v2-undo");

  // Equip an earned item and save: the base revision travels with it.
  await page.click("#v2-tab-wardrobe");
  await page.click("[data-wfilter=owned]");
  assert.ok(await page.locator(".v2-new-badge").count() >= 1, "newly earned items are marked NEW");
  await page.getByRole("button", { name: "EQUIP Champion cape" }).click();
  await page.click("#v2-save");
  await page.waitForFunction(() => document.getElementById("v2-saved").hidden === false);
  assert.deepEqual([puts.at(-1).expectedRevision, puts.at(-1).activeLook, puts.at(-1).v2.back], [3, "v2", "cape"]);
  assert.equal(await page.locator(".mini-photo .mini-v2 svg").count(), 1, "the header portrait uses the shared renderer");
  assert.equal(await page.locator("#look-use-classic").isVisible(), true);
  await page.screenshot({ path: join(root, "test-results", "b2-server-studio.png") });

  // Changed elsewhere: refused, the latest version loads, the edit survives.
  server.revision = 9;
  server.v2 = v2Look({ hair: "locs" });
  await page.click("#v2-tab-create");
  await page.click("#v2-cat-hair");
  await page.getByRole("button", { name: "Afro", exact: true }).click();
  await page.click("#v2-save");
  await page.waitForFunction(() => /changed somewhere else/.test(document.getElementById("v2-toast").textContent));
  assert.equal(puts.at(-1).expectedRevision, 4);
  assert.equal(await page.locator("#v2-save").isEnabled(), true, "the edit is kept, ready to save again");
  await page.click("#v2-save");
  await page.waitForFunction(() => document.getElementById("v2-saved").hidden === false);
  assert.deepEqual([puts.at(-1).expectedRevision, puts.at(-1).v2.hair], [9, "afro"]);

  // An item removed by a results correction: a clear message, nothing lost.
  await page.getByRole("button", { name: "Long curls", exact: true }).click();
  nextPutError = [403, "item_not_owned"];
  await page.click("#v2-save");
  await page.waitForFunction(() => /isn't in your Wardrobe/.test(document.getElementById("v2-toast").textContent));

  // Campus Wins: the consented V2 look or a neutral figure, never a default person.
  await page.click("[data-page=wins]");
  await page.waitForSelector(".win-post");
  assert.equal(await page.locator(".win-avatar .win-v2 svg").count(), 1);
  assert.equal(await page.locator('.win-avatar[data-art="neutral"] img').count(), 1);

  // Sign out while a character load is still in flight: nothing lands afterwards.
  let release;
  holdCharacterGet = { promise: new Promise((resolve) => { release = resolve; }) };
  await page.click("[data-page=avatar]");
  await page.click("#account-entry");
  await page.click("#logout-btn");
  release();
  await page.waitForFunction(() => document.documentElement.dataset.session === "none");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#studio-v2").isHidden(), true);
  assert.equal(await page.locator("#look-switch").isHidden(), true);
  assert.equal(await page.locator(".mini-photo .mini-v2").count(), 0, "the header portrait is cleared");
  assert.equal(await page.evaluate(() => localStorage.getItem("arena-v2-seen-grants")), null, "nothing reward-related stays on a shared device");
  assert.deepEqual(errors, []);
  await context.close();

  // Mobile: the server-backed studio fits a phone.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  server.signedIn = true;
  const mobile = await phone.newPage();
  await phone.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/public/features") return json(route, 200, { studentSignIn: true, avatarPersonalization: true, welcomeDialog: false, characterStudioV2: true });
    if (path === "/api/auth/session") return json(route, 200, { authenticated: true, csrfToken: "x".repeat(43), user: { role: "student", mustChangePassword: false } });
    if (path === "/api/me/character") return json(route, 200, { ...state(), activeLook: "v2", v2: v2Look({ back: "cape" }), grants: [] });
    if (path === "/api/me/avatar") return json(route, 200, { avatar: server.classic, showOnLeaderboard: true, publication: "public" });
    if (path === "/api/public/leaderboards") return json(route, 200, { releaseLabel: "Week 5", publishedAt: today, rows: [] });
    return json(route, 200, { posts: [], submissions: [], reactions: {} });
  });
  await mobile.goto(baseUrl);
  await ready(mobile);
  await mobile.click("[data-page=avatar]");
  await mobile.waitForSelector("#studio-v2:not([hidden]) #v2-stage svg");
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await mobile.locator("#v2-saved").isVisible(), true, "a saved V2 student opens on their saved look");
  await mobile.screenshot({ path: join(root, "test-results", "b2-server-studio-mobile.png") });
  await phone.close();
}

// B1 found that staff.js could load after app.js had already announced the
// first session, so Staff Desk never appeared. Delay staff.js on purpose.
export async function runStaffDeskRaceTests(browser, baseUrl) {
  for (const delayMs of [0, 1500]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.route("**/assets/staff*.js", async (route) => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.continue();
    });
    let previewBody = null;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/public/features") return json(route, 200, { studentSignIn: true, avatarPersonalization: true, welcomeDialog: false, characterStudioV2: true });
      if (path === "/api/auth/session") return json(route, 200, { authenticated: true, csrfToken: "x".repeat(43), user: { role: "admin", mustChangePassword: false, mfaRequired: false } });
      if (path === "/api/staff/leaderboards/history") return json(route, 200, { publications: [
        { id: "33333333-3333-4333-8333-333333333333", version: 12, academicYear: "2026-27", releaseLabel: "Week 5", format: "level_only", state: "live", publishedAt: today, rowCount: 30 },
      ] });
      if (path === "/api/staff/rewards") return json(route, 200, { periods: [] });
      if (path === "/api/staff/rewards/preview") {
        previewBody = JSON.parse(route.request().postData());
        return json(route, 200, { preview: {
          publication: { version: 12, label: "Week 5", current: true }, period: { key: previewBody.periodKey, exists: false, versions: [] },
          rows: 30, linked: 24, eligibleStudents: 24, exclusions: { unlinked: 6, inactiveAccounts: 0 },
          collections: { elite: { newGrants: 24, alreadyGranted: 0, previouslyRevoked: 0, wouldRevoke: 0 }, podium: { newGrants: 8, alreadyGranted: 0, previouslyRevoked: 0, wouldRevoke: 0 }, champion: { newGrants: 3, alreadyGranted: 0, previouslyRevoked: 0, wouldRevoke: 0 } },
          conflicts: { snapshotBoundToPeriod: null, snapshotBoundElsewhere: false, periodSourceMismatch: false }, rewardsSwitchOn: false,
        } });
      }
      return json(route, 200, { rows: [], links: [], posts: [], publications: [], leaderboards: [] });
    });
    await page.goto(baseUrl);
    await ready(page);
    await page.waitForSelector("#staff-nav:not([hidden])", { timeout: 8000 });
    assert.equal(await page.locator("#staff-nav").isVisible(), true, `Staff Desk appears with staff.js delayed ${delayMs} ms`);
    await page.click("#staff-nav");
    await page.waitForFunction(() => document.getElementById("rewards-publication").options.length === 1);
    assert.equal(await page.locator("#rewards-period").inputValue(), "2026-27:week-5", "a period key is suggested from the release");
    await page.click("#rewards-form button[type=submit]");
    await page.waitForSelector("#rewards-preview:not([hidden])");
    assert.deepEqual(previewBody, { publicationId: "33333333-3333-4333-8333-333333333333", periodKey: "2026-27:week-5" });
    assert.match(await page.locator("#rewards-summary").textContent(), /Elite \(Top 10\): 24 new/);
    assert.match(await page.locator("#rewards-warnings").textContent(), /switched off/);
    assert.equal(await page.locator("#rewards-grant").isDisabled(), true, "nothing can be granted while the switch is off");
    await context.close();
  }
}
