// Hotfix: a Staff Desk board-character correction must either visibly save
// (and show what is stored) or visibly fail next to the button. Fictional data.
import assert from "node:assert/strict";

const PUB = "30000000-0000-4000-8000-0000000000f1";
const fulfill = (route, payload, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

export async function runBoardCharacterBrowserTests(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const stored = new Map([["6:8", "zein"], ["6:10", "zein"], ["6:1", "omar"]]);
  let failNext = null;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/public/features") return fulfill(route, { studentSignIn: false, avatarPersonalization: false, welcomeDialog: false });
    if (path === "/api/public/leaderboards") return fulfill(route, { rows: [] });
    if (path === "/api/public/campus-wins") return fulfill(route, { posts: [] });
    if (path === "/api/auth/session") return fulfill(route, {
      authenticated: true, user: { role: "admin", mustChangePassword: false, mfaRequired: false, mfaSetupRequired: false }, csrfToken: "fictional-csrf",
    });
    if (path === "/api/staff/leaderboards/history") return fulfill(route, {
      publications: [{ id: PUB, version: 1, releaseLabel: "Week 5", state: "live", format: "level_only" }],
    });
    if (path === "/api/staff/leaderboards/artwork" && request.method() === "GET") {
      if (failNext === "unauthorized") return fulfill(route, { error: "unauthorized" }, 401);
      return fulfill(route, { rows: [1, 8, 10].map((position) => ({
        level: 6, position, publicName: `Fictional L6 ${position}`, character: stored.get(`6:${position}`) ?? null,
      })) });
    }
    if (path === "/api/staff/leaderboards/artwork" && request.method() === "POST") {
      if (failNext) return fulfill(route, { error: failNext }, failNext === "unauthorized" ? 401 : 503);
      const body = request.postDataJSON();
      stored.clear();
      for (const item of body.assignments) stored.set(`${item.level}:${item.rank}`, item.character);
      return fulfill(route, { approved: body.assignments.length });
    }
    if (path.startsWith("/api/staff/")) return fulfill(route, { posts: [], publications: [] });
    return fulfill(route, { error: "not_found" }, 404);
  });

  await page.goto(baseUrl);
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await page.locator("#staff-nav").click();
  await page.waitForFunction(() => document.getElementById("artwork-publication").options.length > 0);
  await page.locator('#artwork-form button[type="submit"]').click();
  await page.locator("#artwork-review").waitFor({ state: "visible" });

  const row8 = page.locator('select[aria-label="Character for Level 6 rank 8"]');
  assert.match(await row8.locator('option[value="zein"]').textContent(), /wheelchair user/, "the wheelchair character is labelled");
  assert.match(await row8.locator('option[value="habiba2"]').textContent(), /headscarf/);

  // 1. A failed save (expired session) says so beside the button; nothing looks saved.
  failNext = "unauthorized";
  await row8.selectOption("");
  await page.locator("#approve-artwork").click();
  await page.waitForFunction(() => document.getElementById("artwork-result").dataset.state === "unavailable");
  assert.match(await page.locator("#artwork-result").textContent(), /^Not saved: your session ended/);
  assert.equal(await page.locator("#artwork-result").isVisible(), true);
  assert.equal(stored.get("6:8"), "zein", "nothing was stored");

  // 2. A server failure reloads the stored values so the list shows the truth.
  failNext = "unavailable";
  await page.locator('#artwork-form button[type="submit"]').click();
  await row8.selectOption("");
  await page.locator("#approve-artwork").click();
  await page.waitForFunction(() => document.getElementById("artwork-result").dataset.state === "unavailable");
  assert.match(await page.locator("#artwork-result").textContent(), /^Not saved\. Nothing changed on the public board/);
  assert.equal(await row8.inputValue(), "zein", "the dropdown is reset to what is really stored");

  // 3. A successful correction is confirmed from the stored data.
  failNext = null;
  await row8.selectOption("");
  await page.locator('select[aria-label="Character for Level 6 rank 10"]').selectOption("");
  await page.locator("#approve-artwork").click();
  await page.waitForFunction(() => document.getElementById("artwork-result").dataset.state === "ready");
  assert.match(await page.locator("#artwork-result").textContent(), /^Saved: 1 board character\(s\) for v1 · Week 5 · Live\. 1 row\(s\) now have a character/);
  assert.deepEqual([...stored.entries()], [["6:1", "omar"]], "only the approved rows are stored; corrected rows are neutral");
  assert.equal(await row8.inputValue(), "");

  assert.deepEqual(errors, []);
  await page.close();
}
