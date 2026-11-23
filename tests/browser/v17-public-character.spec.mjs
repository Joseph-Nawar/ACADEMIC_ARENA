// Release A: the public board shows a linked, opted-in student's saved look
// (style, backdrop, sticker) on the podium and in ranks 4-10, signed out; a
// fresh load shows a later change; My Character states come from the server;
// Staff Desk shows current links and what an upload would remove.
// Fictional data, mocked BFF. Screenshots go to test-results/.
import assert from "node:assert/strict";
import { join } from "node:path";

const PUB = "30000000-0000-4000-8000-0000000000f7";
const fulfill = (route, payload, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.appReady === "true", null, { timeout: 5000 });

function boardRows(podiumLook) {
  return Array.from({ length: 10 }, (_, index) => {
    const position = index + 1;
    const name = `Fictional Student ${String.fromCharCode(64 + position)}`;
    if (position === 1) return { position, name, ...podiumLook, personalized: true };
    if (position === 6) return { position, name, avatar: "mariam", style: "cartoon3d", tone: "gold", badge: "♥", personalized: true };
    return { position, name, avatar: ["omar", "youssef", "amara", "tariq", "nour2"][position % 5], personalized: false };
  });
}

async function signedOutBoard(browser, baseUrl, root, viewport, label, podiumLook) {
  const context = await browser.newContext({ viewport }); // a fresh, cookie-less visitor
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/public/features") return fulfill(route, { studentSignIn: true, avatarPersonalization: true, welcomeDialog: false });
    if (path === "/api/public/leaderboards") return fulfill(route, { level: 4, releaseLabel: "Week 5", publishedAt: "2026-11-20", rows: boardRows(podiumLook) });
    if (path === "/api/public/campus-wins") return fulfill(route, { posts: [] });
    if (path === "/api/auth/session") return fulfill(route, { authenticated: false });
    return fulfill(route, { error: "not_found" }, 404);
  });
  await page.goto(baseUrl);
  await ready(page);
  await page.locator(".podium-zone").waitFor({ state: "visible" });
  await page.waitForFunction(() => [...document.querySelectorAll(".champion-art, .rank-row img")].every((img) => img.complete && img.naturalWidth > 0));
  const result = await page.evaluate(() => {
    const first = document.querySelector(".competitor.first");
    const second = document.querySelector(".competitor.second");
    const rank6 = [...document.querySelectorAll(".rank-row")].find((row) => row.querySelector("b").textContent === "06");
    const rank5 = [...document.querySelectorAll(".rank-row")].find((row) => row.querySelector("b").textContent === "05");
    return {
      firstSrc: first.querySelector(".champion-art").getAttribute("src"),
      firstArt: first.dataset.art, firstTone: first.dataset.tone, firstStyle: first.dataset.style,
      firstSticker: first.querySelector(".board-sticker")?.textContent ?? null,
      firstBackdrop: getComputedStyle(first, "::before").backgroundColor,
      secondSrc: second.querySelector(".champion-art").getAttribute("src"), secondTone: second.dataset.tone ?? null,
      secondSticker: second.querySelector(".board-sticker")?.textContent ?? null,
      rank6Src: rank6.querySelector("img").getAttribute("src"), rank6Tone: rank6.querySelector(".pic").dataset.tone,
      rank6Sticker: rank6.querySelector(".board-sticker")?.textContent ?? null,
      rank6Background: getComputedStyle(rank6.querySelector(".pic")).backgroundColor,
      rank5Src: rank5.querySelector("img").getAttribute("src"), rank5Sticker: rank5.querySelector(".board-sticker")?.textContent ?? null,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  await page.locator(".arena-grid").screenshot({ path: join(root, "test-results", `v17-board-${label}.png`) });
  assert.deepEqual(errors, []);
  await context.close();
  return result;
}

async function studioStates(browser, baseUrl, root, viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const look = { base: "tariq", style: "ink", tone: "coral", badge: "⚡" };
  const server = { publication: "awaiting_link", saves: 0 };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/public/features") return fulfill(route, { studentSignIn: true, avatarPersonalization: true, welcomeDialog: false });
    if (path === "/api/public/leaderboards") return fulfill(route, { rows: [] });
    if (path === "/api/public/campus-wins") return fulfill(route, { posts: [] });
    if (path === "/api/auth/session") return fulfill(route, { authenticated: true, user: { role: "student", mustChangePassword: false }, csrfToken: "fictional-csrf" });
    if (path === "/api/me/avatar" && request.method() === "PUT") {
      server.saves += 1;
      const body = request.postDataJSON();
      Object.assign(look, body.avatar);
      return fulfill(route, { saved: true, avatar: look, showOnLeaderboard: body.showOnLeaderboard, publication: server.publication });
    }
    if (path === "/api/me/avatar") return fulfill(route, { avatar: look, showOnLeaderboard: true, publication: server.publication });
    if (path === "/api/me/achievements") return fulfill(route, { submissions: [] });
    if (path === "/api/me/campus-win-reactions") return fulfill(route, { reactions: {} });
    return fulfill(route, { error: "not_found" }, 404);
  });
  await page.goto(baseUrl);
  await ready(page);
  await page.locator("#profile-link").click();
  await page.locator("#publication-state").waitFor({ state: "visible" });
  const label1 = await page.locator("#publication-state-label").textContent();
  assert.equal(label1, "AWAITING STAFF VERIFICATION", "opted in without a link is never called public");
  assert.equal(await page.locator("#publication-state-unsaved").isVisible(), false);
  // An unsaved edit is called out; the server then says the student is public.
  await page.locator('.swatch[data-tone="lilac"]').click();
  assert.equal(await page.locator("#publication-state-unsaved").isVisible(), true, "unsaved edits are flagged as not public");
  server.publication = "public";
  await page.locator("#save-character").click();
  await page.waitForFunction(() => document.getElementById("publication-state").dataset.state === "public");
  assert.equal(await page.locator("#publication-state-unsaved").isVisible(), false);
  assert.match(await page.locator("#publication-state-text").textContent(), /next time anyone loads it/);
  await page.locator(".studio-controls").screenshot({ path: join(root, "test-results", `v17-studio-public-${label}.png`) });
  // Opt-out: the server answer drives the line, never the checkbox alone.
  await page.locator("#show-on-leaderboard").uncheck();
  assert.equal(await page.locator("#publication-state-unsaved").isVisible(), true);
  server.publication = "display_off";
  await page.locator("#save-character").click();
  await page.waitForFunction(() => document.getElementById("publication-state").dataset.state === "display_off");
  assert.equal(await page.locator("#publication-state-label").textContent(), "PUBLIC DISPLAY OFF");
  // A state the browser does not recognise is shown as unavailable, never public.
  server.publication = "something-new";
  await page.locator("#save-character").click();
  await page.waitForFunction(() => document.getElementById("publication-state").dataset.state === "unknown");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await context.close();
}

async function staffLinks(browser, baseUrl, root) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  let approvedBody = null;
  let dialogText = "";
  page.on("dialog", (dialog) => { dialogText = dialog.message(); return dialog.accept(); });
  const current = [
    { level: 4, position: 1, publicName: "Fictional Student A", username: "fictional-alpha" },
    { level: 5, position: 6, publicName: "Fictional Student F", username: "fictional-bravo" },
  ];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/public/features") return fulfill(route, { studentSignIn: true, avatarPersonalization: true, welcomeDialog: false });
    if (path === "/api/public/leaderboards") return fulfill(route, { rows: [] });
    if (path === "/api/public/campus-wins") return fulfill(route, { posts: [] });
    if (path === "/api/auth/session") return fulfill(route, {
      authenticated: true, user: { role: "admin", mustChangePassword: false, mfaRequired: false, mfaSetupRequired: false }, csrfToken: "fictional-csrf" });
    if (path === "/api/staff/leaderboards/history") return fulfill(route, {
      publications: [{ id: PUB, version: 1, releaseLabel: "Week 5", state: "live", format: "level_only" }] });
    if (path === "/api/staff/leaderboards/links" && request.method() === "GET") {
      assert.equal(url.searchParams.get("publicationId"), PUB);
      return fulfill(route, { links: current });
    }
    if (path === "/api/staff/leaderboards/links/preview") return fulfill(route, { links: [
      { level: 4, position: 1, publicName: "Fictional Student A", username: "fictional-alpha", accountStatus: "active", previous: "new" },
      { level: 6, position: 2, publicName: "Fictional Student B", username: "fictional-charlie", accountStatus: "active", previous: "new" },
    ] });
    if (path === "/api/staff/leaderboards/links/approve") {
      approvedBody = request.postDataJSON();
      return fulfill(route, { linked: 2 });
    }
    if (path.startsWith("/api/staff/")) return fulfill(route, { posts: [], publications: [], rows: [] });
    return fulfill(route, { error: "not_found" }, 404);
  });
  await page.goto(baseUrl);
  await ready(page);
  await page.locator("#staff-nav").click();
  await page.locator("#links-current").waitFor({ state: "visible" });
  assert.equal(await page.locator("#links-current-heading").textContent(), "CURRENTLY APPROVED (2)");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#download-links").click()]);
  const { readFile } = await import("node:fs/promises");
  assert.equal(await readFile(await download.path(), "utf8"), "level,rank,username\n4,1,fictional-alpha\n5,6,fictional-bravo\n",
    "the download is exactly the current set, ready to extend");
  // An upload that forgets bravo: the preview says bravo will be removed.
  await page.locator("#links-file").setInputFiles({ name: "links.csv", mimeType: "text/csv",
    buffer: Buffer.from("level,rank,username\n4,1,fictional-alpha\n6,2,fictional-charlie\n") });
  await page.locator('#links-form button[type="submit"]').click();
  await page.locator("#links-preview").waitFor({ state: "visible" });
  assert.equal(await page.locator("#links-removed-block").isVisible(), true);
  assert.match(await page.locator("#links-removed").textContent(), /Level 5 · rank 6 · Fictional Student F → fictional-bravo/);
  await page.locator("#links-preview").screenshot({ path: join(root, "test-results", "v17-staff-links-preview.png") });
  await page.locator("#approve-links").click();
  await page.waitForFunction(() => /approved/.test(document.getElementById("staff-status").textContent));
  assert.match(dialogText, /REMOVES 1 current link/, "the confirmation names the removal");
  assert.equal(approvedBody.publicationId, PUB);
  await context.close();
}

export async function runPublicCharacterBrowserTests(browser, baseUrl, root) {
  const podium = { avatar: "tariq", style: "ink", tone: "coral", badge: "⚡" };
  for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const board = await signedOutBoard(browser, baseUrl, root, viewport, label, podium);
    assert.equal(board.firstSrc, "assets/characters/tariq-ink.png", `${label}: the podium keeps the saved Comic style`);
    assert.deepEqual([board.firstArt, board.firstTone, board.firstStyle, board.firstSticker], ["personal", "coral", "ink", "⚡"]);
    assert.equal(board.firstBackdrop, "rgb(239, 111, 86)", `${label}: the coral backdrop is drawn behind the podium character`);
    assert.match(board.secondSrc, /-3d\.png$/u, "reviewed defaults stay 3D");
    assert.deepEqual([board.secondTone, board.secondSticker], [null, null], "defaults carry no student backdrop or sticker");
    assert.equal(board.rank6Src, "assets/characters/mariam-3d-face.jpg");
    assert.deepEqual([board.rank6Tone, board.rank6Sticker, board.rank6Background], ["gold", "♥", "rgb(244, 200, 86)"], `${label}: ranks 4-10 show backdrop and sticker`);
    assert.equal(board.rank5Sticker, null);
    assert.match(board.rank5Src, /-3d-face\.jpg$/u);
    assert.equal(board.overflow, false, `${label}: no horizontal scroll`);
  }
  // A later save by the same student: the next fresh, signed-out load shows it.
  const changed = await signedOutBoard(browser, baseUrl, root, { width: 1280, height: 900 }, "desktop-after-resave",
    { avatar: "zein", style: "cartoon3d", tone: "lilac", badge: "★" });
  assert.deepEqual([changed.firstSrc, changed.firstTone, changed.firstSticker], ["assets/characters/zein-3d.png", "lilac", "★"]);
  await studioStates(browser, baseUrl, root, { width: 1280, height: 900 }, "desktop");
  await studioStates(browser, baseUrl, root, { width: 390, height: 844 }, "mobile");
  await staffLinks(browser, baseUrl, root);
}
