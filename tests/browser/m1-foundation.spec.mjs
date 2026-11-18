import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const fakeNames = /\b(Mariam|Omar|Youssef|Salma|Ahmed|Nour|Karim|Laila|Tarek|Habiba)\b/;

async function waitForReady(page) {
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true", null, { timeout: 2500 });
}

export async function runDemoBrowserTests(browser, baseUrl, root) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl);
  await waitForReady(page);

  assert.equal(await page.locator("#name-1").textContent(), "Mariam");
  assert.equal(await page.locator("#name-2").textContent(), "Omar");
  assert.equal(await page.locator(".podium-zone").isVisible(), true);
  await page.screenshot({ path: join(root, "test-results", "academic-arena-desktop.png"), fullPage: true });
  const crown = await page.locator(".crown").boundingBox();
  const visibleWinnerTop = await page.locator("#art-1").evaluate(async (image) => {
    if (!image.complete) await new Promise((resolve) => { image.onload = resolve; });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = Math.floor(canvas.width * 0.25); x < Math.ceil(canvas.width * 0.75); x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] > 16) return image.getBoundingClientRect().y + y * image.getBoundingClientRect().height / canvas.height;
      }
    }
    return Number.POSITIVE_INFINITY;
  });
  assert.ok(crown && crown.y + crown.height < visibleWinnerTop + 8,
    `crown must sit above visible art (crown bottom ${crown?.y + crown?.height}; art top ${visibleWinnerTop})`);

  assert.equal(await page.locator("#leaderboard-title").innerText(), "LEVEL\nCHAMPIONS.");
  assert.match(await page.locator("#leaderboard-subtitle").textContent(), /· Quiz Leaderboard$/u);
  assert.equal(await page.evaluate(() => document.querySelectorAll(
    "#semester-filter, #group-filter, #module-filter, #tab-semester, #tab-module, #level-filter").length), 0,
    "no semester, cohort, or module controls exist");
  assert.equal(await page.locator('.level-tabs [data-level="4"]').getAttribute("aria-pressed"), "true", "Level 4 is the default");
  const boards = {};
  for (const level of ["5", "6", "4"]) {
    await page.locator(`.level-tabs [data-level="${level}"]`).click();
    await page.waitForFunction((value) => document.getElementById("podium-label").textContent === `LEVEL ${value} / TOP 3` &&
      document.getElementById("ranking-status").dataset.state === "ready", level);
    boards[level] = await page.evaluate(() => ({
      podium: [1, 2, 3].map((position) => document.getElementById(`name-${position}`).textContent),
      rest: [...document.querySelectorAll("#ranking-rows li")].map((row) => row.querySelector("b").textContent + " " + row.querySelector(".person").textContent),
    }));
    assert.equal(boards[level].rest.length, 7, `Level ${level} shows ranks 4-10 below the podium`);
    assert.deepEqual(boards[level].rest.map((row) => row.slice(0, 2)), ["04", "05", "06", "07", "08", "09", "10"]);
    assert.equal(await page.locator(`.level-tabs [data-level="${level}"]`).getAttribute("aria-pressed"), "true");
  }
  assert.equal(new Set(Object.values(boards).map((board) => board.podium.join("|"))).size, 3, "each level shows its own rankings");

  await page.locator('.nav-link[data-page="avatar"]').click();
  await page.locator('button[data-base="amara"]').click();
  await page.locator('button[data-style="cartoon3d"]').click();
  assert.match(await page.locator("#studio-art").getAttribute("src"), /amara-3d\.png$/);
  await page.waitForFunction(() => document.getElementById("studio-art").naturalWidth > 0);
  await page.locator('button[data-style="ink"]').click();
  assert.match(await page.locator("#studio-art").getAttribute("src"), /amara-ink\.png$/);
  await page.waitForFunction(() => document.getElementById("studio-art").naturalWidth > 0);
  await page.locator('button[data-tone="coral"]').click();
  await page.locator('button[data-badge="★"]').click();
  await page.locator("#save-character").click();
  assert.match(await page.locator("#save-status").textContent(), /saved in this browser/i);
  assert.equal(await page.locator("#studio-stage").getAttribute("data-tone"), "coral");

  await page.locator('.nav-link[data-page="wins"]').click();
  await page.waitForFunction(() => document.querySelectorAll("#wins-feed .win-post").length === 4);
  await page.screenshot({ path: join(root, "test-results", "academic-arena-wins-desktop.png"), fullPage: true });
  await page.locator('.wins-filter[data-filter="academic"]').click();
  assert.equal(await page.locator("#wins-feed .win-post").count(), 2);
  await page.locator('.wins-filter[data-filter="consistency"]').click();
  assert.equal(await page.locator("#wins-feed .win-post").count(), 1);
  await page.locator('.wins-filter[data-filter="community"]').click();
  assert.equal(await page.locator("#wins-feed .win-post").count(), 1);
  await page.locator('.wins-filter[data-filter="all"]').click();
  const reaction = page.locator("#wins-feed .win-post").first().locator(".react-btn").first();
  const oldCount = await reaction.textContent();
  await reaction.click();
  await page.waitForFunction((oldValue) =>
    document.querySelector("#wins-feed .win-post .react-btn").textContent !== oldValue, oldCount);
  await page.locator("#open-composer").click();
  await page.locator("#achievement-type").selectOption("project");
  assert.equal(await page.locator("textarea").count(), 0);
  await page.locator('#achievement-form button[type="submit"]').click();
  assert.equal(await page.locator("#pending-panel").isVisible(), true);
  await page.locator("#approve-demo").click();
  await page.waitForFunction(() => document.querySelectorAll("#wins-feed .win-post").length === 5);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileWins = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    postCount: document.querySelectorAll("#wins-feed .win-post").length,
    reactionVisible: document.querySelector("#wins-feed .react-btn").getBoundingClientRect().width > 0,
  }));
  assert.ok(mobileWins.documentWidth <= mobileWins.width + 1, "Campus Wins must not overflow on mobile");
  assert.equal(mobileWins.postCount, 5);
  assert.equal(mobileWins.reactionVisible, true);
  const mobileReaction = page.locator("#wins-feed .win-post").first().locator(".react-btn").first();
  const oldMobileCount = await mobileReaction.textContent();
  await mobileReaction.click();
  await page.waitForFunction((oldValue) =>
    document.querySelector("#wins-feed .win-post .react-btn").textContent !== oldValue, oldMobileCount);

  await page.locator('.nav-link[data-page="leaderboard"]').click();
  await page.screenshot({ path: join(root, "test-results", "academic-arena-mobile.png"), fullPage: true });
  const mobile = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    levelVisible: document.querySelector(".level-tabs").getBoundingClientRect().width > 0,
    podiumVisible: !document.querySelector(".podium-zone").hidden,
    crownVisible: document.querySelector(".crown").getBoundingClientRect().width > 0,
    demoLabelVisible: document.querySelector(".demo-stamp").getBoundingClientRect().width > 0 &&
      getComputedStyle(document.querySelector(".demo-stamp")).display !== "none",
  }));
  assert.ok(mobile.documentWidth <= mobile.width + 1, "mobile page must not overflow horizontally");
  assert.equal(mobile.levelVisible, true);
  assert.equal(mobile.podiumVisible, true);
  assert.equal(mobile.crownVisible, true);
  assert.equal(mobile.demoLabelVisible, true, "fictional demo disclosure must remain visible at phone widths");
  assert.deepEqual(errors, []);
  await page.close();
}

export async function runProductionBrowserTests(browser, baseUrl, root) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const requested = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));
  await page.goto(baseUrl);
  await waitForReady(page);
  assert.match(await page.locator("#ranking-status").textContent(), /temporarily unavailable/i);
  assert.equal(await page.locator(".podium-zone").isVisible(), false);
  assert.equal(await page.locator(".rank-sheet").isVisible(), false);
  assert.doesNotMatch(await page.locator("body").innerText(), fakeNames);
  assert.equal(requested.some((path) => path.includes("/fixtures/demo/")), false);
  assert.equal(requested.some((path) => path.includes("supabase")), false);
  await page.screenshot({ path: join(root, "test-results", "academic-arena-production-unavailable.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    unavailable: document.getElementById("ranking-status").textContent.includes("temporarily unavailable"),
    podiumHidden: document.querySelector(".podium-zone").hidden,
  }));
  assert.ok(mobile.documentWidth <= mobile.width + 1, "production mobile page must not overflow horizontally");
  assert.equal(mobile.unavailable, true);
  assert.equal(mobile.podiumHidden, true);

  const response = await page.request.get(baseUrl);
  const headers = await response.headers();
  assert.match(headers["content-security-policy"] || "", /default-src 'self'/);
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.match(headers["cache-control"] || "", /no-cache/);

  const appBundle = await (await page.request.get(baseUrl + "/assets/app.js")).text();
  const dataBundle = await (await page.request.get(baseUrl + "/assets/data-access.js")).text();
  assert.doesNotMatch(appBundle + dataBundle, /sb_secret_|service_role|@supabase\/supabase-js/i);
  assert.deepEqual(errors, []);
  await page.close();

  const redirectPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let loginPostBody = null;
  const redirectTargetBodies = [];
  await redirectPage.route("**/api/auth/login", async (route) => {
    loginPostBody = route.request().postData();
    await route.fulfill({
      status: 307,
      headers: { location: "https://redirect-capture.example.test/collect" },
    });
  });
  await redirectPage.route("https://redirect-capture.example.test/**", async (route) => {
    redirectTargetBodies.push(route.request().postData());
    await route.fulfill({ status: 204 });
  });
  await redirectPage.goto(baseUrl);
  await waitForReady(redirectPage);
  const loginFailedClosed = await redirectPage.evaluate(async () => {
    const api = window.AcademicArenaDataAccess.createArenaDataAccess({ mode: "production" });
    try {
      await api.auth.signIn({ username: "fictional-student", password: "fictional-only-password" });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(loginFailedClosed, true, "credential-bearing login must fail on a 307 response");
  assert.equal(loginPostBody, JSON.stringify({ username: "fictional-student", password: "fictional-only-password" }));
  assert.deepEqual(redirectTargetBodies, [], "login credentials must not reach the redirect target");
  await redirectPage.close();

  const emptyBoardPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let catalogRequests = 0;
  await emptyBoardPage.route("**/api/public/catalog**", async (route) => {
    catalogRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  let liveRows = [];
  await emptyBoardPage.route("**/api/public/leaderboards**", async (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ rows: liveRows, releaseLabel: liveRows.length ? "Week 9" : null, publishedAt: null }),
  }));
  await emptyBoardPage.goto(baseUrl);
  await waitForReady(emptyBoardPage);
  assert.match(await emptyBoardPage.locator("#ranking-status").textContent(), /no approved standings are published for level 4/i);
  assert.equal(await emptyBoardPage.locator("#ranking-status").getAttribute("data-state"), "empty");
  assert.equal(await emptyBoardPage.locator(".podium-zone").isHidden(), true);
  assert.equal(catalogRequests, 0, "the level-only page never requests the legacy catalog");
  liveRows = ["Alpha", "Bravo", "Charlie"].map((name, index) => ({ position: index + 1, name: `Fictional ${name}`, avatar: "omar", style: "ink" }));
  await emptyBoardPage.locator('.nav-link[data-page="wins"]').click();
  await emptyBoardPage.locator('.nav-link[data-page="leaderboard"]').click();
  await emptyBoardPage.waitForFunction(() => document.getElementById("name-1").textContent === "Fictional Alpha");
  assert.equal(await emptyBoardPage.locator("#leaderboard-subtitle").textContent(), "Week 9 · Quiz Leaderboard", "returning to the page refetches");
  liveRows = [];
  await emptyBoardPage.locator('.level-tabs [data-level="4"]').click();
  await emptyBoardPage.waitForFunction(() => document.getElementById("ranking-status").dataset.state === "empty");
  assert.equal(await emptyBoardPage.locator(".podium-zone").isHidden(), true, "a withdrawal shows after re-selecting the level");
  await emptyBoardPage.close();

  // V1.2: long multi-part names show first + final component, collisions expand,
  // the full approved name stays as tooltip and accessible text, and tags wrap
  // (at most two lines) without overflowing at desktop, tablet, and phone widths.
  const longNames = [
    "Fictional Abdelrahman Mohamed Elsayed Zakariyya", "Testname Hassanein Abdelghany Elbaaly",
    "Sample Noureldin Khaled Siefeldin Elmahdy", "Sample Kamal Elmahdy", "Sample Fawzy Elmahdy",
    "Mononym", "Two Parts", "Fictional Omar Ali", "Fictional Omar Hany Ali", "Placeholder Example Person",
  ];
  const expectedShort = [
    "Fictional Zakariyya", "Testname Elbaaly", "Sample Noureldin Elmahdy", "Sample Kamal Elmahdy", "Sample Fawzy Elmahdy",
    "Mononym", "Two Parts", "Fictional Omar Ali", "Fictional Omar Hany Ali", "Placeholder Person",
  ];
  for (const [width, height] of [[1440, 900], [820, 1100], [390, 844]]) {
    const namesPage = await browser.newPage({ viewport: { width, height } });
    await namesPage.route("**/api/public/leaderboards**", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ releaseLabel: "Week 9", publishedAt: null,
        rows: longNames.map((name, index) => ({ position: index + 1, name, avatar: "omar", style: "ink" })) }),
    }));
    await namesPage.goto(baseUrl);
    await waitForReady(namesPage);
    await namesPage.waitForFunction(() => document.getElementById("name-1").title !== "");
    const layout = await namesPage.evaluate(() => {
      const visible = (element) => element.querySelector("[aria-hidden]")?.textContent ?? element.textContent;
      const tags = [1, 2, 3].map((index) => document.getElementById(`name-${index}`));
      return {
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        identityBars: document.querySelectorAll(".eue-identity-bar").length,
        headers: document.querySelectorAll("header.topbar").length,
        eueVisible: document.querySelector(".eue-endorsement").getBoundingClientRect().width > 0,
        visibleNames: [...tags, ...document.querySelectorAll("#ranking-rows .person")].map(visible),
        fullNames: [...tags, ...document.querySelectorAll("#ranking-rows .person")].map((element) => element.title || element.textContent),
        tags: tags.map((tag) => {
          const box = tag.getBoundingClientRect();
          const lineHeight = parseFloat(getComputedStyle(tag).lineHeight);
          const inner = tag.querySelector("[aria-hidden]") || tag;
          return { left: box.left, right: box.right, lines: Math.round(inner.getBoundingClientRect().height / lineHeight),
            clipped: inner.scrollHeight > inner.clientHeight + 1 };
        }),
      };
    });
    assert.equal(layout.identityBars, 0, "the duplicate EUE identity bar is gone");
    assert.equal(layout.headers, 1, "one workspace header");
    assert.equal(layout.eueVisible, true, "EUE branding stays in the navigation brand area");
    assert.ok(layout.documentWidth <= layout.width + 1, `no horizontal overflow at ${width}px`);
    assert.deepEqual(layout.visibleNames, expectedShort, "first + final name, collisions expanded");
    assert.deepEqual(layout.fullNames, longNames, "complete approved names stay available");
    for (const tag of layout.tags) {
      assert.ok(tag.left >= 0 && tag.right <= layout.width, `podium tag stays inside the viewport at ${width}px`);
      assert.ok(tag.lines <= 2 && !tag.clipped, `podium tag wraps to at most two lines without clipping at ${width}px`);
    }
    await namesPage.close();
  }

  // V1.2 welcome dialog: backend-controlled, accessible, once per browser, never for signed-in users.
  const welcomeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const welcomePage = await welcomeContext.newPage();
  let signedIn = false;
  await welcomePage.route("**/api/public/features", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ studentSignIn: true, avatarPersonalization: true, welcomeDialog: true }),
  }));
  await welcomePage.route("**/api/auth/session", (route) => route.fulfill(signedIn
    ? { status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, csrfToken: "x".repeat(43), user: { role: "student", mustChangePassword: false } }) }
    : { status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) }));
  await welcomePage.route("**/api/public/leaderboards**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ releaseLabel: "Week 9", publishedAt: null, rows: [
      { position: 1, name: "Fictional Chosen", avatar: "zein", style: "cartoon3d", tone: "lilac", badge: "⚡", personalized: true },
      { position: 2, name: "Fictional Default", avatar: "omar", style: "ink", personalized: false },
      { position: 3, name: "Fictional Third", avatar: "mariam", style: "ink", personalized: false },
    ] }),
  }));
  await welcomePage.goto(baseUrl);
  await waitForReady(welcomePage);
  const dialog = await welcomePage.evaluate(() => {
    const element = document.querySelector("#welcome-backdrop .dialog");
    return {
      visible: !document.getElementById("welcome-backdrop").hidden,
      role: element.getAttribute("role"), modal: element.getAttribute("aria-modal"),
      title: document.getElementById(element.getAttribute("aria-labelledby"))?.textContent,
      focused: document.activeElement?.id,
      boardVisible: !document.querySelector(".podium-zone").hidden,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  assert.equal(dialog.visible, true, "welcome dialog appears when the backend enables it");
  assert.equal(dialog.role, "dialog");
  assert.equal(dialog.modal, "true");
  assert.match(dialog.title, /YOUR NAME\.\s*YOUR CHARACTER\./u);
  assert.equal(dialog.focused, "welcome-signin", "focus moves into the dialog");
  assert.equal(dialog.boardVisible, true, "the public board loads behind the dialog");
  assert.ok(dialog.overflow <= 1, "dialog does not overflow at phone width");
  await welcomePage.keyboard.press("Shift+Tab");
  assert.equal(await welcomePage.evaluate(() => document.activeElement?.closest("#welcome-backdrop") !== null), true, "focus stays in the dialog");
  await welcomePage.keyboard.press("Escape");
  assert.equal(await welcomePage.locator("#welcome-backdrop").isHidden(), true, "Escape closes the dialog");
  const stored = await welcomePage.evaluate(() => ({ ...localStorage }));
  assert.deepEqual(stored, { "arena-welcome-dismissed": "v1" }, "dismissal stores only a version marker");
  await welcomePage.locator('.level-tabs [data-level="5"]').click();
  assert.equal(await welcomePage.locator("#welcome-backdrop").isHidden(), true, "changing level never reopens it");
  await welcomePage.reload();
  await waitForReady(welcomePage);
  assert.equal(await welcomePage.locator("#welcome-backdrop").isHidden(), true, "shown once per browser");
  assert.equal(await welcomePage.locator("#art-1").getAttribute("alt"), "Character chosen by the rank 1 student");
  assert.match(await welcomePage.locator("#art-1").getAttribute("src"), /zein-3d\.png$/u, "an opted-in student's own character is shown");
  assert.equal(await welcomePage.locator("#art-2").getAttribute("alt"), "Default illustrated character for rank 2");
  assert.match(await welcomePage.locator(".artwork-note").textContent(), /Default illustrated characters are shown until students choose their own/u);
  await welcomePage.evaluate(() => localStorage.clear());
  signedIn = true;
  await welcomePage.reload();
  await waitForReady(welcomePage);
  assert.equal(await welcomePage.locator("#welcome-backdrop").isHidden(), true, "never shown to signed-in visitors");
  await welcomeContext.close();

  const offPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await offPage.goto(baseUrl);
  await waitForReady(offPage);
  assert.equal(await offPage.locator("#welcome-backdrop").isHidden(), true, "no dialog while the backend switches are off");
  assert.equal(await offPage.locator("#public-avatar-group").isHidden(), true, "no public-display option while personalization is off");
  await offPage.close();

  const racePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let levelFourStarted = false;
  await racePage.route("**/api/public/leaderboards**", async (route) => {
    const url = new URL(route.request().url());
    const level = url.searchParams.get("level");
    if (level === "5") {
      levelFourStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 450));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const name = level === "5" ? "Stale Level Five" : level === "6" ? "Current Level Six <img src=x onerror=window.__arenaInjected=true>" : "Initial Level Four";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        publishedAt: "Fictional mocked response",
        rows: [
          { position: 1, name, avatar: "mariam", style: "ink" },
          { position: 2, name: "Second Place", avatar: "omar", style: "ink" },
          { position: 3, name: "Third Place", avatar: "youssef", style: "ink" },
          { position: 4, name: "Fourth Place", avatar: "amara", style: "ink" },
        ],
      }),
    });
  });
  await racePage.goto(baseUrl);
  await waitForReady(racePage);
  const levelFourRequest = racePage.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith("/public/leaderboards") && url.searchParams.get("level") === "5";
  });
  await racePage.locator('.level-tabs [data-level="5"]').click();
  await levelFourRequest;
  await racePage.locator('.level-tabs [data-level="6"]').click();
  await racePage.waitForFunction(() => document.getElementById("name-1").title.startsWith("Current Level Six"));
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(levelFourStarted, true);
  assert.equal(await racePage.locator("#name-1").locator("img").count(), 0);
  assert.equal(await racePage.evaluate(() => window.__arenaInjected || false), false);
  assert.match(await racePage.locator("#name-1 .sr-only").textContent(), /^Current Level Six <img/);
  assert.match(await racePage.locator("#podium-label").textContent(), /LEVEL 6/);
  await racePage.close();

  await mkdir(join(root, "test-results"), { recursive: true });
}
