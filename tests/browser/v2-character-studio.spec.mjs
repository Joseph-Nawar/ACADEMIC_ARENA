// Release B1: Character Studio V2 in the fictional demo (desktop and mobile),
// and its absence in production until the V2 switch ships. Screenshots go to
// test-results/.
import assert from "node:assert/strict";
import { join } from "node:path";

const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.appReady === "true", null, { timeout: 5000 });

// Playwright's screenshot injects its own stylesheet (to hide the caret); the
// strict CSP blocks it and WebKit logs that. Only while a screenshot is taken
// is exactly that message dropped, so app CSP violations still fail the test.
const PLAYWRIGHT_STYLE = /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/;
async function shot(page, errors, options) {
  const before = errors.length;
  await page.screenshot(options);
  await page.waitForTimeout(50);
  for (let index = errors.length - 1; index >= before; index -= 1) if (PLAYWRIGHT_STYLE.test(errors[index])) errors.splice(index, 1);
}

async function openStudio(browser, baseUrl, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(baseUrl);
  await ready(page);
  await page.click("[data-page=avatar]");
  await page.waitForSelector("#v2-stage svg");
  return { context, page, errors };
}

export async function runCharacterStudioV2DemoTests(browser, baseUrl, root) {
  // Desktop: create, history, locked preview, rewards, wardrobe, save.
  {
    const { context, page, errors } = await openStudio(browser, baseUrl, { viewport: { width: 1440, height: 900 } });
    assert.equal(await page.locator("#studio-classic").isHidden(), true, "custom studio is the default in the demo");
    assert.equal(await page.locator("#v2-dirty").textContent(), "● NOT SAVED YET");
    const before = await page.locator("#v2-stage-art").innerHTML();
    await page.click("#v2-cat-hair");
    await page.getByRole("button", { name: "Afro", exact: true }).click();
    await page.click("#v2-cat-headwear");
    const beanie = page.getByRole("button", { name: /^Beanie/ });
    assert.equal(await beanie.getAttribute("aria-disabled"), "true", "a fitted hat over big hair is disabled");
    await page.getByRole("button", { name: "Wrapped headscarf" }).click();
    assert.notEqual(await page.locator("#v2-stage-art").innerHTML(), before);
    await page.click("#v2-undo");
    await page.click("#v2-undo");
    assert.equal(await page.locator("#v2-stage-art").innerHTML().then((html) => html.replace(/aa\d+-/g, "")), before.replace(/aa\d+-/g, ""), "undo restores the exact look");
    await page.keyboard.press("Control+Shift+Z");
    await page.click("#v2-redo");
    // A locked item can be tried on but not saved.
    await page.getByRole("button", { name: /Champion's laurel/ }).click();
    assert.equal(await page.locator("#v2-locked-note").isVisible(), true);
    assert.equal(await page.locator("#v2-save").isDisabled(), true, "save is blocked while a locked item is on");
    await page.getByRole("button", { name: "None", exact: true }).first().click();
    assert.equal(await page.locator("#v2-save").isEnabled(), true);
    // Randomize only uses owned, compatible items.
    for (let i = 0; i < 12; i += 1) {
      await page.click("#v2-random");
      assert.equal(await page.locator("#v2-locked-note").isHidden(), true, "randomize never picks a locked item");
    }
    // Keyboard: category tabs move with the arrow keys.
    await page.focus("#v2-cat-headwear");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement.id), "v2-cat-glasses");
    // A simulated verified first place grants three collections, once.
    await page.selectOption("#v2-simulate", "1");
    await page.waitForSelector("#v2-celebrate:not([hidden])");
    assert.equal(await page.evaluate(() => document.activeElement.id), "v2-celebrate-open", "focus moves into the dialog");
    assert.match(await page.locator("#v2-announce").textContent(), /Reward unlocked/);
    await shot(page, errors, { path: join(root, "test-results", "v2-desktop-celebrate.png") });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#v2-celebrate").isHidden(), true);
    await page.selectOption("#v2-simulate", "3");
    assert.equal(await page.locator("#v2-celebrate").isHidden(), true, "no duplicate grant");
    assert.match(await page.locator("#v2-toast").textContent(), /never granted twice/);
    await page.click("#v2-tab-wardrobe");
    await page.click("[data-wfilter=locked]");
    const locked = await page.locator(".v2-item").count();
    assert.ok(locked >= 3, "inactive Scholar and Seasonal items stay locked");
    await page.click("[data-wfilter=owned]");
    await page.getByRole("button", { name: "EQUIP Champion cape" }).click();
    await page.click("#v2-save");
    assert.equal(await page.locator("#v2-saved").isVisible(), true);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("arena-v2-demo-character")));
    assert.equal(stored.back, "cape");
    await shot(page, errors, { path: join(root, "test-results", "v2-desktop-wardrobe.png") });
    await page.click("#v2-tab-pass");
    assert.ok(await page.locator(".v2-tier").count() >= 6);
    assert.match(await page.locator("#v2-pass-banner").textContent(), /isn't switched on/);
    // Classic look stays available.
    await page.click("[data-look=classic]");
    assert.equal(await page.locator("#studio-classic").isVisible(), true);
    await page.click("[data-look=v2]");
    // The public board draws V2 looks with the same renderer.
    await page.click("[data-page=leaderboard]");
    await page.waitForSelector(".champion-v2 svg");
    assert.ok(await page.locator(".pic-v2 svg").count() >= 1, "rank thumbnails use the shared renderer");
    assert.equal(await page.locator(".champion-art:not([hidden])").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Mobile: sticky preview, scrollable categories, no page overflow, reduced motion.
  {
    const { context, page, errors } = await openStudio(browser, baseUrl, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no horizontal page overflow");
    assert.equal(await page.locator(".v2-preview").evaluate((element) => getComputedStyle(element).position), "sticky");
    await page.locator("#v2-cat-shoes").click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "category scroll stays inside its bar");
    for (const id of ["v2-undo", "v2-redo", "v2-random", "v2-reset", "v2-save"]) {
      const box = await page.locator(`#${id}`).boundingBox();
      assert.ok(box.height >= 40 && box.width >= 40, `${id} is a usable touch target`);
    }
    await page.selectOption("#v2-simulate", "7");
    await page.waitForSelector("#v2-celebrate:not([hidden])");
    assert.equal(await page.locator("#v2-confetti i").count(), 0, "no confetti with reduced motion");
    await page.click("#v2-celebrate-open");
    await shot(page, errors, { path: join(root, "test-results", "v2-mobile-wardrobe.png") });
    assert.deepEqual(errors, []);
    await context.close();
  }
}

// Production keeps the classic studio until the V2 API and switch ship (B2).
export async function runCharacterStudioV2ProductionTests(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false, studentSignIn: false, rows: [], posts: [] }) }));
  await page.goto(baseUrl);
  await ready(page);
  assert.equal(await page.locator("#studio-v2").isHidden(), true);
  assert.equal(await page.locator("#look-switch").isHidden(), true);
  assert.equal(await page.locator("#v2-demo-tools").textContent(), "", "no demo copy in production");
  await context.close();
}
