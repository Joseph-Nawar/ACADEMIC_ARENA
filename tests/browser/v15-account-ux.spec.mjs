// V1.5 pilot feedback: the student sign-in and password-change journey, the
// header's SIGN IN / ACCOUNT state across refresh, re-authentication and
// sign-out, and stale or failed session checks. Fictional data, mocked BFF.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const TEMP = "fictional-temporary-pass";
const NEW = "fictional-new-password-2026";

async function waitForReady(page) {
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true", null, { timeout: 5000 });
}

const fulfill = (route, payload, status = 200, headers = {}) =>
  route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(payload) });

// A small stateful fake of the BFF: one student account with a temporary password.
function fakeServer(options = {}) {
  const state = { signedIn: false, mustChange: true, password: TEMP, changeCalls: 0, sessionDelayMs: 0, sessionFailures: 0 };
  Object.assign(state, options);
  const session = () => (state.signedIn
    ? { authenticated: true, user: { role: "student", mustChangePassword: state.mustChange }, csrfToken: "fictional-csrf" }
    : { authenticated: false });
  async function handle(route) {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/public/features") return fulfill(route, { studentSignIn: true, avatarPersonalization: false, welcomeDialog: false });
    if (path === "/api/public/leaderboards") return fulfill(route, { rows: [] });
    if (path === "/api/public/campus-wins") return fulfill(route, { posts: [] });
    if (path === "/api/auth/session") {
      const snapshot = session();
      if (state.sessionFailures > 0) {
        state.sessionFailures -= 1;
        return fulfill(route, { error: "unavailable" }, 503);
      }
      if (state.sessionDelayMs) await delay(state.sessionDelayMs);
      return fulfill(route, snapshot);
    }
    if (path === "/api/auth/login") {
      const body = request.postDataJSON();
      if (body.username !== "fictional-student" || body.password !== state.password) return fulfill(route, { error: "invalid_credentials" }, 401);
      state.signedIn = true;
      return fulfill(route, session());
    }
    if (path === "/api/auth/change-password") {
      state.changeCalls += 1;
      const body = request.postDataJSON();
      if (!state.signedIn || body.oldPassword !== state.password) return fulfill(route, { error: "password_change_failed" }, 400);
      state.password = body.newPassword;
      state.mustChange = false;
      state.signedIn = false;
      return fulfill(route, { changed: true, authenticated: false });
    }
    if (path === "/api/auth/logout") {
      state.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/me/avatar" && request.method() === "PUT") {
      state.lastCsrf = request.headers()["x-csrf-token"] || "";
      if (!state.signedIn) return fulfill(route, { error: "unauthorized" }, 401);
      if (state.lastCsrf !== "fictional-csrf") return fulfill(route, { error: "request_rejected" }, 403);
      const body = request.postDataJSON();
      return fulfill(route, { saved: true, avatar: body.avatar, showOnLeaderboard: false });
    }
    if (path === "/api/me/avatar") {
      if (!state.signedIn) return fulfill(route, { error: "unauthorized" }, 401);
      if (state.mustChange) return fulfill(route, { error: "password_change_required" }, 409);
      return fulfill(route, { avatar: { base: "tariq", style: "cartoon3d", tone: "gold", badge: "★" }, showOnLeaderboard: false });
    }
    if (path === "/api/me/achievements") return fulfill(route, { submissions: [] });
    if (path === "/api/me/campus-win-reactions") return fulfill(route, { reactions: {} });
    return fulfill(route, { error: "not_found" }, 404);
  }
  return { state, handle };
}

const visible = (page, selector) => page.locator(selector).isVisible();
const header = (page) => page.locator("#account-entry").textContent();

async function signIn(page, password) {
  if (await page.locator("#login-backdrop").isHidden()) await page.locator("#account-entry").click();
  await page.locator("#login-username").fill("fictional-student");
  await page.locator("#login-password").fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator("#account-panel").waitFor({ state: "visible" });
}

async function studentJourney(browser, baseUrl, viewport) {
  const label = `${viewport.width}px`;
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const server = fakeServer();
  await page.route("**/api/**", server.handle);

  await page.goto(baseUrl);
  await waitForReady(page);
  assert.equal(await header(page), "SIGN IN", `${label}: signed-out header`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.session), "none");

  // 1. Temporary password: the change is required and is the only thing offered.
  await signIn(page, TEMP);
  assert.equal(await header(page), "ACCOUNT", `${label}: header switches immediately after sign-in`);
  assert.equal(await page.locator("#account-entry").getAttribute("data-state"), "action-needed");
  assert.equal(await visible(page, "#password-section"), true, `${label}: password change is required`);
  assert.equal(await page.locator("#password-title").textContent(), "SET YOUR OWN PASSWORD");
  assert.equal(await visible(page, "#cancel-password-change"), false, "a required change cannot be cancelled");
  assert.equal(await visible(page, "#show-password-change"), false);
  assert.equal(await visible(page, "#student-next"), false, "character tools wait for the new password");
  assert.match(await page.locator("#account-status").textContent(), /temporary password/i);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "old-password");

  // Mismatched confirmation is caught before anything is sent.
  await page.locator("#old-password").fill(TEMP);
  await page.locator("#new-password").fill(NEW);
  await page.locator("#confirm-password").fill(`${NEW}-typo`);
  await page.locator('#change-password-form button[type="submit"]').click();
  assert.match(await page.locator("#password-status").textContent(), /don’t match/);
  assert.equal(server.state.changeCalls, 0);

  // 2. Successful change: the form is cleared and closed; sign in again with the new password.
  await page.locator("#confirm-password").fill(NEW);
  await page.locator('#change-password-form button[type="submit"]').click();
  await page.locator("#login-form").waitFor({ state: "visible" });
  assert.equal(await page.locator("#login-status").textContent(), "Password changed. Sign in with your new password.");
  assert.equal(await visible(page, "#account-panel"), false);
  assert.equal(await visible(page, "#password-section"), false, `${label}: password form gone after completion`);
  assert.deepEqual(await page.evaluate(() => ["old-password", "new-password", "confirm-password"].map((id) => document.getElementById(id).value)),
    ["", "", ""], "no password stays in the form");
  assert.equal(await page.locator("#login-username").inputValue(), "fictional-student", "username is kept for re-authentication");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "login-password");
  assert.equal(await header(page), "SIGN IN");

  // 3. Normal sign-in: a clear next action, no password form.
  await signIn(page, NEW);
  assert.equal(await header(page), "ACCOUNT");
  assert.equal(await page.locator("#account-entry").getAttribute("data-state"), "signed-in");
  assert.equal(await page.locator("#account-status").textContent(), "You’re signed in.");
  assert.equal(await visible(page, "#password-section"), false, `${label}: password form hidden when not required`);
  assert.equal(await visible(page, "#show-password-change"), true, "voluntary change stays available");
  assert.equal(await visible(page, "#student-next"), true);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "open-studio");
  await page.waitForFunction(() => document.getElementById("nav-portrait").src.includes("tariq"));
  assert.match(await page.locator("#save-note").textContent(), /Saved to your Arena account\. Showing characters on public leaderboards isn’t switched on yet\./);

  // Voluntary change opens and cancels cleanly.
  await page.locator("#show-password-change").click();
  assert.equal(await visible(page, "#password-section"), true);
  assert.equal(await page.locator("#password-title").textContent(), "CHANGE PASSWORD");
  await page.locator("#old-password").fill("half-typed");
  await page.locator("#cancel-password-change").click();
  assert.equal(await visible(page, "#password-section"), false);
  assert.equal(await page.locator("#old-password").inputValue(), "");

  // Open My Character goes to the studio with the saved character.
  await page.locator("#open-studio").click();
  assert.equal(await visible(page, "#login-backdrop"), false);
  assert.equal(await visible(page, "#page-avatar"), true);
  assert.match(await page.locator("#studio-art").getAttribute("src"), /tariq/);
  if (viewport.width < 500) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no horizontal scroll on mobile");
  }

  // 4. Refresh keeps the signed-in state and does not reopen the dialog.
  await page.reload();
  await waitForReady(page);
  assert.equal(await header(page), "ACCOUNT", `${label}: header correct after refresh`);
  assert.equal(await visible(page, "#login-backdrop"), false);
  await page.waitForFunction(() => document.getElementById("nav-portrait").src.includes("tariq"));

  // 5. Sign out: header, portrait and studio all return to signed-out.
  await page.locator("#account-entry").click();
  await page.locator("#logout-btn").click();
  await page.locator("#login-form").waitFor({ state: "visible" });
  assert.equal(await header(page), "SIGN IN");
  assert.match(await page.locator("#nav-portrait").getAttribute("src"), /competitors\/thumb-a\.svg$/);
  assert.match(await page.locator("#studio-art").getAttribute("src"), /amara/);
  assert.equal(await page.locator("#save-note").textContent(), "Sign in with your Arena account to save.");
  await page.reload();
  await waitForReady(page);
  assert.equal(await header(page), "SIGN IN", `${label}: still signed out after refresh`);

  assert.deepEqual(errors, []);
  await page.close();
}

async function temporaryPasswordAfterRefresh(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const server = fakeServer({ signedIn: true, mustChange: true });
  await page.route("**/api/**", server.handle);
  await page.goto(baseUrl);
  await waitForReady(page);
  assert.equal(await header(page), "ACCOUNT");
  assert.equal(await visible(page, "#login-backdrop"), true, "a pending temporary password reopens the account dialog");
  assert.equal(await page.locator("#password-title").textContent(), "SET YOUR OWN PASSWORD");
  await page.locator("#close-account").click();
  await page.locator('.nav-link[data-page="avatar"]').click();
  await page.locator("#save-character").click();
  assert.equal(await visible(page, "#login-backdrop"), true, "saving a character first asks for the new password");
  await page.close();
}

async function staleAndFailedSessionChecks(browser, baseUrl) {
  // A slow initial "signed out" answer must not overwrite a sign-in that happened meanwhile.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const server = fakeServer({ mustChange: false, password: NEW, sessionDelayMs: 2500 });
  await page.route("**/api/**", server.handle);
  await page.goto(baseUrl);
  await page.locator("#account-entry").click();
  await page.locator("#login-username").fill("fictional-student");
  await page.locator("#login-password").fill(NEW);
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator("#account-panel").waitFor({ state: "visible" });
  await waitForReady(page);
  await delay(300);
  assert.equal(await header(page), "ACCOUNT", "a stale session check never flips the header back to SIGN IN");
  assert.equal(await visible(page, "#account-panel"), true);
  await page.close();

  // A transient failure is retried instead of being shown as signed out.
  const retry = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const flaky = fakeServer({ signedIn: true, mustChange: false, password: NEW, sessionFailures: 1 });
  await retry.route("**/api/**", flaky.handle);
  await retry.goto(baseUrl);
  await waitForReady(retry);
  assert.equal(await header(retry), "ACCOUNT", "one failed session check is retried");
  await retry.close();
}

async function backgroundRechecks(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const server = fakeServer({ signedIn: true, mustChange: false, password: NEW });
  await page.route("**/api/**", server.handle);
  await page.goto(baseUrl);
  await waitForReady(page);
  await page.waitForFunction(() => document.getElementById("nav-portrait").src.includes("tariq"));
  const restore = () => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));

  // An unsaved studio edit survives a re-check that finds the same session.
  await page.locator('.nav-link[data-page="avatar"]').click();
  await page.locator('#base-options button').first().click();
  const edited = await page.locator("#studio-art").getAttribute("src");
  assert.doesNotMatch(edited, /tariq/);
  await restore();
  await delay(500);
  assert.equal(await page.locator("#studio-art").getAttribute("src"), edited, "a background re-check keeps unsaved edits");

  // A re-check that fails keeps the session and its CSRF token: saving still works.
  server.state.sessionFailures = 2;
  await restore();
  await delay(1800);
  assert.equal(await header(page), "ACCOUNT");
  await page.locator("#save-character").click();
  await page.waitForFunction(() => /saved to your account/i.test(document.getElementById("save-status").textContent));
  assert.equal(server.state.lastCsrf, "fictional-csrf", "the CSRF token survives a failed session check");

  // The account dialog keeps keyboard focus inside it.
  await page.locator("#account-entry").click();
  await page.locator("#close-account").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("#login-backdrop"))), true, "Tab stays in the dialog");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("#login-backdrop"))), true, "Shift+Tab stays in the dialog");
  await page.close();
}

export async function runAccountUxBrowserTests(browser, baseUrl) {
  await backgroundRechecks(browser, baseUrl);
  await studentJourney(browser, baseUrl, { width: 1440, height: 900 });
  await studentJourney(browser, baseUrl, { width: 390, height: 844 });
  await temporaryPasswordAfterRefresh(browser, baseUrl);
  await staleAndFailedSessionChecks(browser, baseUrl);
}
