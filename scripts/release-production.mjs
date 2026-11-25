// Owner-run production release steps that refuse to continue unless the checkout
// is exactly the reviewed code. Nothing here runs by itself.
//
//   node scripts/release-production.mjs verify  --tree <40-hex>
//   node scripts/release-production.mjs migrate --tree <40-hex> --expect 202611230001_character_publication_state.sql
//   node scripts/release-production.mjs deploy  --tree <40-hex>
//   node scripts/release-production.mjs smoke
//
// <tree> comes from the release report and the PR comment, never from this
// repository: `git rev-parse <reviewed-head>^{tree}`. A merge commit of the
// reviewed PR onto an unchanged main has the same tree, so it passes; any other
// content, an extra file, a dirty or ignored file, a stale main, a branch other
// than main, or a missing or failed CI run on the commit fails.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";
import { checkRelease } from "./lib/release-guard.mjs";

const root = path.resolve(import.meta.dirname, "..");
const PRODUCTION = { ref: "jhukafyrdredfkzyzggw", pages: "academic-arena", site: "https://academic-arena.pages.dev" };
const die = (message) => { console.error(`STOP: ${message}`); process.exit(1); };
const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({ args: rest, options: { tree: { type: "string" }, expect: { type: "string", multiple: true } }, strict: true });
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: "utf8", stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit" });

function guard() {
  const problems = checkRelease({ cwd: root, expectedTree: values.tree });
  if (problems.length) {
    console.error("The checkout is not a verified release:");
    for (const problem of problems) console.error(`  - ${problem}`);
    die("nothing was changed in production");
  }
  console.log("Verified: the code, the working tree, main and CI all match the reviewed release.");
}

if (command === "smoke") {
  let failed = false;
  const status = async (url) => { try { const r = await fetch(url); return { code: r.status, cache: r.headers.get("cache-control") }; } catch { return { code: 0, cache: null }; } };
  for (const level of [4, 5, 6]) {
    const r = await status(`${PRODUCTION.site}/api/public/leaderboards?level=${level}`);
    const good = r.code === 200 && /no-store/u.test(r.cache || "");
    console.log(`${good ? "ok  " : "FAIL"} level ${level}: ${r.code} ${r.cache}`); failed ||= !good;
  }
  for (const [label, url] of [["avatar (signed out)", "/api/me/avatar"], ["staff links (signed out)", "/api/staff/leaderboards/links?publicationId=00000000-0000-4000-8000-000000000000"]]) {
    const r = await status(`${PRODUCTION.site}${url}`);
    console.log(`${r.code === 401 ? "ok  " : "FAIL"} ${label}: ${r.code}`); failed ||= r.code !== 401;
  }
  process.exit(failed ? 1 : 0);
}
if (!["verify", "migrate", "deploy"].includes(command)) die("use verify, migrate, deploy or smoke");
if (!values.tree) die("--tree <40-hex> is required");
guard();
if (command === "verify") process.exit(0);

if (command === "migrate") {
  if (!values.expect?.length) die("--expect <migration file> is required: say exactly which migration(s) you expect to apply");
  const dry = run("node", ["scripts/hosted-sql.mjs", PRODUCTION.ref, "migrate", "--dry-run"], { capture: true });
  if (dry.status !== 0) die("the dry run failed");
  const pending = dry.stdout.split("\n").filter((line) => /^would apply\s/u.test(line)).map((line) => line.replace(/^would apply\s+/u, "").trim());
  const matches = pending.length === values.expect.length && [...pending].sort().join() === [...values.expect].sort().join();
  console.log(`Pending: ${pending.join(", ") || "none"}`);
  if (!matches) die(`the pending migrations differ from the expected ones (${values.expect.join(", ")})`);
  process.stdout.write("Type APPLY to run these migrations on PRODUCTION: ");
  const answer = await new Promise((resolve) => process.stdin.once("data", (data) => resolve(String(data).trim())));
  if (answer !== "APPLY") die("not confirmed");
  guard(); // re-check immediately before the change
  process.exit(run("node", ["scripts/hosted-sql.mjs", PRODUCTION.ref, "migrate"]).status ?? 1);
}

// deploy: build from the verified tree, verify again, then upload exactly that build.
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
if (run("npm", ["run", "build:production"]).status !== 0) die("the production build failed");
guard();
process.stdout.write(`Type DEPLOY to publish this build of ${head.slice(0, 12)} to ${PRODUCTION.pages}: `);
const answer = await new Promise((resolve) => process.stdin.once("data", (data) => resolve(String(data).trim())));
if (answer !== "DEPLOY") die("not confirmed");
process.exit(run("npx", ["--no-install", "wrangler", "pages", "deploy", "dist", "--project-name", PRODUCTION.pages, "--branch", "main", "--commit-hash", head, "--commit-dirty=false"]).status ?? 1);
