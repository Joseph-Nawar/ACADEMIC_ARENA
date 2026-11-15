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

  for (const level of ["4", "5", "6"]) {
    await page.locator("#level-filter").selectOption(level);
    await page.waitForFunction((value) => document.getElementById("level-filter").value === value &&
      document.getElementById("podium-label").textContent.includes("LEVEL " + value), level);
  }
  for (const semester of ["1", "2"]) {
    await page.locator("#semester-filter").selectOption(semester);
    await page.waitForFunction((value) => document.getElementById("semester-filter").value === value &&
      document.getElementById("podium-label").textContent.includes("SEM " + value), semester);
  }
  await page.locator("#tab-module").click();
  assert.equal(await page.locator("#module-wrap").isVisible(), true);
  for (const [key, label] of [["module-a", "Module A"], ["module-b", "Module B"], ["module-c", "Module C"]]) {
    await page.locator("#module-filter").selectOption(key);
    await page.waitForFunction((value) => document.getElementById("module-filter").value === value &&
      document.getElementById("sheet-subtitle").textContent.includes(value === "module-a" ? "Module A" :
        value === "module-b" ? "Module B" : "Module C"), key);
    assert.ok((await page.locator("#podium-label").textContent()).includes(label));
  }
  await page.locator("#tab-semester").click();
  assert.equal(await page.locator("#module-wrap").isVisible(), false);

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

  await page.locator('.nav-link[data-page="leaderboard"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(root, "test-results", "academic-arena-mobile.png"), fullPage: true });
  const mobile = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    levelVisible: document.getElementById("level-filter").getBoundingClientRect().width > 0,
    podiumVisible: !document.querySelector(".podium-zone").hidden,
    crownVisible: document.querySelector(".crown").getBoundingClientRect().width > 0,
  }));
  assert.ok(mobile.documentWidth <= mobile.width + 1, "mobile page must not overflow horizontally");
  assert.equal(mobile.levelVisible, true);
  assert.equal(mobile.podiumVisible, true);
  assert.equal(mobile.crownVisible, true);
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

  const emptyCatalogPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let leaderboardRequests = 0;
  await emptyCatalogPage.route("**/api/public/catalog**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ groups: [], modules: {} }),
  }));
  await emptyCatalogPage.route("**/api/public/leaderboards**", async (route) => {
    leaderboardRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: [] }) });
  });
  await emptyCatalogPage.goto(baseUrl);
  await waitForReady(emptyCatalogPage);
  assert.match(await emptyCatalogPage.locator("#ranking-status").textContent(), /no cohorts/i);
  assert.equal(await emptyCatalogPage.locator("#ranking-status").getAttribute("data-state"), "empty");
  assert.equal(await emptyCatalogPage.locator("#group-filter").isDisabled(), true);
  assert.equal(await emptyCatalogPage.locator("#group-filter").inputValue(), "");
  assert.equal(leaderboardRequests, 0, "do not query rankings without a cohort");
  await emptyCatalogPage.close();

  const racePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let levelFourStarted = false;
  await racePage.route("**/api/public/leaderboards**", async (route) => {
    const url = new URL(route.request().url());
    const level = url.searchParams.get("level");
    if (level === "4") {
      levelFourStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 450));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const name = level === "4" ? "Stale Level Four" : "Current Level Six <img src=x onerror=window.__arenaInjected=true>";
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
  await racePage.route("**/api/public/catalog**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      groups: [{ key: "core", label: "Core module selection" }],
      modules: { core: [{ key: "module-a", label: "Module A" }] },
    }),
  }));
  await racePage.goto(baseUrl);
  await waitForReady(racePage);
  const levelFourRequest = racePage.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith("/public/leaderboards") && url.searchParams.get("level") === "4";
  });
  await racePage.locator("#level-filter").selectOption("4");
  await levelFourRequest;
  await racePage.locator("#level-filter").selectOption("6");
  await racePage.waitForFunction(() => document.getElementById("name-1").textContent.startsWith("Current Level Six"));
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(levelFourStarted, true);
  assert.equal(await racePage.locator("#name-1").locator("img").count(), 0);
  assert.equal(await racePage.evaluate(() => window.__arenaInjected || false), false);
  assert.match(await racePage.locator("#name-1").textContent(), /^Current Level Six <img/);
  assert.match(await racePage.locator("#podium-label").textContent(), /LEVEL 6/);
  await racePage.close();

  await mkdir(join(root, "test-results"), { recursive: true });
}
