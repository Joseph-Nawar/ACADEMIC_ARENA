import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runDemoBrowserTests, runProductionBrowserTests } from "../tests/browser/m1-foundation.spec.mjs";
import { runM2AuthBrowserTests } from "../tests/browser/m2-auth.spec.mjs";
import { runAccountUxBrowserTests } from "../tests/browser/v15-account-ux.spec.mjs";
import { runBoardCharacterBrowserTests } from "../tests/browser/board-characters.spec.mjs";
import { runPublicCharacterBrowserTests } from "../tests/browser/v17-public-character.spec.mjs";
import { runCharacterStudioV2DemoTests, runCharacterStudioV2ProductionTests } from "../tests/browser/v2-character-studio.spec.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const buildScript = join(root, "scripts", "build.mjs");

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startPages() {
  const port = await reservePort();
  const child = spawn(process.execPath, [
    wrangler, "pages", "dev", "dist",
    "--ip", "127.0.0.1",
    "--port", String(port),
    "--inspector-port", "0",
    "--log-level", "error",
    "--show-interactive-dev-session", "false",
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-10000); });
  child.stderr.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-10000); });
  const baseUrl = "http://127.0.0.1:" + port;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    if (child.exitCode !== null) throw new Error("Wrangler Pages exited early:\n" + logs);
    try {
      const response = await fetch(baseUrl + "/");
      if (response.ok) return { child, baseUrl, logs: () => logs };
    } catch {}
    await delay(150);
  }
  child.kill("SIGTERM");
  throw new Error("Wrangler Pages did not become ready:\n" + logs);
}

async function stopPages(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    delay(3000),
  ]);
}

function build(mode) {
  const result = spawnSync(process.execPath, [buildScript, "--mode", mode], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || ("Build failed: " + mode));
}

await mkdir(join(root, "test-results"), { recursive: true });
const browser = await chromium.launch({ headless: true });
let server;
try {
  server = await startPages();
  await runDemoBrowserTests(browser, server.baseUrl, root);
  await runCharacterStudioV2DemoTests(browser, server.baseUrl, root);
  await stopPages(server);
  server = null;

  build("production");
  server = await startPages();
  await runProductionBrowserTests(browser, server.baseUrl, root);
  await runM2AuthBrowserTests(browser, server.baseUrl);
  await runAccountUxBrowserTests(browser, server.baseUrl);
  await runBoardCharacterBrowserTests(browser, server.baseUrl);
  await runPublicCharacterBrowserTests(browser, server.baseUrl, root);
  await runCharacterStudioV2ProductionTests(browser, server.baseUrl);
  console.log("PASS: Wrangler Pages demo, production-unavailable, filters, avatar, Campus Wins, authentication states, headers, and desktop/mobile checks.");
} finally {
  await stopPages(server);
  await browser.close();
}
