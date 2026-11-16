import assert from "node:assert/strict";

async function waitForReady(page) {
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true", null, { timeout: 2500 });
}

async function json(route, payload, status = 200, extraHeaders = {}) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: extraHeaders,
    body: JSON.stringify(payload),
  });
}

export async function runM2AuthBrowserTests(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const requests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({ path, method: request.method(), body: request.postData() });
    if (path === "/api/public/catalog") return json(route, {
      groups: [{ key: "core", label: "Core cohort" }],
      modules: { core: [{ key: "module-a", label: "Module A" }] },
    });
    if (path === "/api/public/leaderboards") return json(route, { rows: [] });
    if (path === "/api/public/campus-wins") return json(route, { posts: [] });
    if (path === "/api/auth/session") return json(route, { authenticated: false });
    if (path === "/api/me/avatar") return json(route, { error: "unauthorized" }, 401);
    if (path === "/api/auth/login") {
      const credentials = request.postDataJSON();
      if (credentials.username === "fictional-admin") {
        return json(route, {
          authenticated: true,
          user: { role: "admin", mustChangePassword: false, mfaRequired: true, mfaSetupRequired: true },
          csrfToken: "fictional-csrf",
          email: "private@academic-arena.test",
          access_token: "provider-access-token",
          refresh_token: "provider-refresh-token",
        }, 200, {
          "Set-Cookie": "__Host-aa_session=fictional-opaque-session; Path=/; Secure; HttpOnly; SameSite=Strict",
        });
      }
      return json(route, {
        authenticated: true,
        user: { role: "student", mustChangePassword: true },
        csrfToken: "fictional-student-csrf",
      }, 200, {
        "Set-Cookie": "__Host-aa_session=fictional-student-session; Path=/; Secure; HttpOnly; SameSite=Strict",
      });
    }
    if (path === "/api/auth/mfa/enroll") return json(route, {
      secret: "FICTIONAL-ONE-TIME-TOTP-SECRET",
      totpUri: "otpauth://totp/Academic%20Arena:fictional-admin?secret=FICTIONAL-ONE-TIME-TOTP-SECRET",
      email: "private@academic-arena.test",
      access_token: "provider-access-token",
    });
    if (path === "/api/auth/mfa/verify") return json(route, {
      authenticated: true,
      user: { role: "admin", mustChangePassword: false, mfaRequired: false, mfaSetupRequired: false },
      refresh_token: "provider-refresh-token",
    });
    if (path === "/api/auth/change-password") return json(route, { changed: true, authenticated: false }, 200, {
      "Set-Cookie": "__Host-aa_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict",
    });
    if (path === "/api/auth/logout") return route.fulfill({ status: 204 });
    return json(route, { error: "not_found" }, 404);
  });

  await page.goto(baseUrl);
  await waitForReady(page);
  await page.locator("#account-entry").click();
  await page.locator("#login-username").fill("fictional-admin");
  await page.locator("#login-password").fill("fictional-only-password");
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator("#mfa-enroll-form").waitFor({ state: "visible" });
  assert.match(await page.locator("#mfa-status").textContent(), /set up an authenticator/i);
  assert.equal(await page.locator("#change-password-form").isVisible(), true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mfa-enroll-form button[type="submit"]').click();
  await page.locator("#mfa-secret").waitFor({ state: "visible" });
  assert.equal(await page.locator("#mfa-secret").textContent(), "FICTIONAL-ONE-TIME-TOTP-SECRET");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true,
    "the staff authenticator setup remains within the mobile viewport");
  assert.equal(await page.evaluate(() => document.cookie.includes("aa_session")), false,
    "the opaque session cookie is not readable by page JavaScript");
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("FICTIONAL-ONE-TIME-TOTP-SECRET")), false,
    "the one-time setup secret is not stored in browser local storage");
  await page.locator("#mfa-code").fill("123456");
  await page.locator('#mfa-code-form button[type="submit"]').click();
  await page.locator("#mfa-panel").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#mfa-secret").textContent(), "");
  assert.equal(await page.locator("#account-status").textContent(), "Staff verification is complete.");
  assert.equal(requests.some(({ body }) => String(body).includes("provider-access-token")), false);
  assert.equal(requests.some(({ body }) => String(body).includes("private@academic-arena.test")), false);
  assert.equal(requests.find(({ path }) => path === "/api/auth/mfa/verify")?.body, JSON.stringify({ code: "123456" }));
  await page.close();

  const passwordPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  passwordPage.on("pageerror", (error) => errors.push(error.message));
  await passwordPage.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/public/catalog") return json(route, { groups: [], modules: {} });
    if (path === "/api/public/leaderboards") return json(route, { rows: [] });
    if (path === "/api/public/campus-wins") return json(route, { posts: [] });
    if (path === "/api/auth/session") return json(route, { authenticated: false });
    if (path === "/api/me/avatar") return json(route, { error: "unauthorized" }, 401);
    if (path === "/api/auth/login") return json(route, {
      authenticated: true,
      user: { role: "student", mustChangePassword: true },
      csrfToken: "fictional-student-csrf",
    });
    if (path === "/api/auth/change-password") return json(route, { changed: true, authenticated: false }, 200, {
      "Set-Cookie": "__Host-aa_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict",
    });
    return json(route, { error: "not_found" }, 404);
  });
  await passwordPage.goto(baseUrl);
  await waitForReady(passwordPage);
  await passwordPage.locator("#account-entry").click();
  await passwordPage.locator("#login-username").fill("fictional-student");
  await passwordPage.locator("#login-password").fill("fictional-initial-password");
  await passwordPage.locator('#login-form button[type="submit"]').click();
  await passwordPage.waitForFunction(() =>
    document.getElementById("account-status").textContent.toLowerCase().includes("change your initial password"));
  assert.match(await passwordPage.locator("#account-status").textContent(), /change your initial password/i);
  await passwordPage.locator("#old-password").fill("fictional-initial-password");
  await passwordPage.locator("#new-password").fill("fictional-new-password-2026");
  await passwordPage.locator('#change-password-form button[type="submit"]').click();
  await passwordPage.locator("#login-status").waitFor({ state: "visible" });
  assert.match(await passwordPage.locator("#login-status").textContent(), /sign in again/i);
  assert.equal(await passwordPage.locator("#login-form").isVisible(), true);
  assert.equal(await passwordPage.locator("#account-panel").isVisible(), false);
  assert.deepEqual(errors, []);
  await passwordPage.close();
}
