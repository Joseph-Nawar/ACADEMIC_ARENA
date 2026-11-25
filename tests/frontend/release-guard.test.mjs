// The production release guard fails closed. Temporary git repositories only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkRelease, git } from "../../scripts/lib/release-guard.mjs";

const ok = (runs = [["Build", "completed", "success"], ["DB", "completed", "success"]]) => () => ({ ok: true, runs });
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "aa-guard-"));
  const sh = (...args) => { const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "t@example.test"); sh("config", "user.name", "t");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\ndist/\n.dev.vars\n/supabase/.temp/\n");
  writeFileSync(join(dir, "app.js"), "reviewed\n");
  sh("add", "-A"); sh("commit", "-q", "-m", "reviewed");
  return { dir, sh, tree: sh("rev-parse", "HEAD^{tree}"), commit: sh("rev-parse", "HEAD"), done: () => rmSync(dir, { recursive: true, force: true }) };
}
const base = (r, extra = {}) => ({ cwd: r.dir, expectedTree: r.tree, fetch: false, ci: ok(), ...extra });

test("the reviewed tree on a clean main with green CI passes", () => {
  const r = repo();
  try {
    assert.deepEqual(checkRelease(base(r)), []);
    mkdirSync(join(r.dir, "node_modules")); writeFileSync(join(r.dir, "node_modules", "x"), "x");
    mkdirSync(join(r.dir, "dist")); writeFileSync(join(r.dir, "dist", "x"), "x");
    mkdirSync(join(r.dir, "supabase", ".temp"), { recursive: true }); writeFileSync(join(r.dir, "supabase", ".temp", "project-ref"), "x");
    assert.deepEqual(checkRelease(base(r)), [], "node_modules, dist and the linked project ref are expected");
    assert.deepEqual(checkRelease(base(r, { expectedCommit: r.commit })), []);
  } finally { r.done(); }
});

test("a different tree, a different commit or a malformed id is refused", () => {
  const r = repo();
  try {
    writeFileSync(join(r.dir, "app.js"), "changed\n"); r.sh("commit", "-q", "-am", "unreviewed change");
    assert.match(checkRelease(base(r)).join("\n"), /not the reviewed code/u);
    assert.match(checkRelease(base(r, { expectedTree: r.sh("rev-parse", "HEAD^{tree}"), expectedCommit: r.commit })).join("\n"), /HEAD is/u);
    for (const bad of ["", "abc", r.tree.toUpperCase(), `${r.tree}0`, undefined]) assert.equal(checkRelease(base(r, { expectedTree: bad })).length, 1);
    assert.equal(checkRelease(base(r, { expectedTree: r.tree, expectedCommit: "nothex" })).length, 1);
  } finally { r.done(); }
});

test("modified, untracked and ignored-but-relevant files are refused", () => {
  const r = repo();
  try {
    writeFileSync(join(r.dir, "app.js"), "edited\n");
    assert.match(checkRelease(base(r)).join("\n"), /modified file: app\.js/u);
    r.sh("checkout", "--", "app.js");
    writeFileSync(join(r.dir, "extra.js"), "x");
    assert.match(checkRelease(base(r)).join("\n"), /untracked file: extra\.js/u);
    rmSync(join(r.dir, "extra.js"));
    writeFileSync(join(r.dir, ".dev.vars"), "SECRET=1");
    assert.match(checkRelease(base(r)).join("\n"), /ignored file present: \.dev\.vars/u);
    rmSync(join(r.dir, ".dev.vars"));
    assert.deepEqual(checkRelease(base(r)), []);
  } finally { r.done(); }
});

test("another branch or a detached HEAD is refused; a stale main is refused", () => {
  const r = repo();
  try {
    r.sh("checkout", "-q", "-b", "feature");
    assert.match(checkRelease(base(r)).join("\n"), /not on the main branch \(feature\)/u);
    r.sh("checkout", "-q", "--detach");
    assert.match(checkRelease(base(r)).join("\n"), /detached HEAD/u);
    r.sh("checkout", "-q", "main");
    // origin/main differs from HEAD
    const remote = mkdtempSync(join(tmpdir(), "aa-guard-remote-"));
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    r.sh("remote", "add", "origin", remote); r.sh("push", "-q", "origin", "main");
    assert.deepEqual(checkRelease(base(r, { fetch: true })), []);
    writeFileSync(join(r.dir, "later.js"), "x"); r.sh("add", "-A"); r.sh("commit", "-q", "-m", "later"); r.sh("push", "-q", "origin", "main");
    r.sh("reset", "-q", "--hard", r.commit);
    assert.match(checkRelease(base(r, { fetch: true })).join("\n"), /not the current origin\/main/u);
    rmSync(remote, { recursive: true, force: true });
    r.sh("remote", "set-url", "origin", "/nonexistent/path");
    assert.match(checkRelease(base(r, { fetch: true })).join("\n"), /cannot fetch origin\/main/u, "an unreachable remote fails closed");
  } finally { r.done(); }
});

test("CI that is missing, pending, failed, cancelled or unreadable is refused", () => {
  const r = repo();
  try {
    for (const [runs, pattern] of [
      [[["Build", "completed", "success"]], /expected at least 2/u],
      [[["Build", "completed", "success"], ["DB", "in_progress", null]], /"DB" is in_progress/u],
      [[["Build", "completed", "success"], ["DB", "completed", "failure"]], /"DB" is failure/u],
      [[["Build", "completed", "success"], ["DB", "completed", "cancelled"]], /"DB" is cancelled/u],
      [[], /expected at least 2/u],
    ]) assert.match(checkRelease(base(r, { ci: ok(runs) })).join("\n"), pattern);
    assert.match(checkRelease(base(r, { ci: () => ({ ok: false, reason: "cannot read CI results from GitHub (is gh signed in?)" }) })).join("\n"), /cannot read CI/u);
  } finally { r.done(); }
});

test("outside a git checkout everything is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "aa-guard-none-"));
  try {
    assert.deepEqual(checkRelease({ cwd: dir, expectedTree: "a".repeat(40), fetch: false, ci: ok() }), ["not inside a git checkout"]);
    assert.equal(git(dir, ["rev-parse", "HEAD"]).ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the CLI refuses before touching production when arguments are wrong", () => {
  for (const args of [[], ["deploy"], ["migrate", "--tree", "a".repeat(40)], ["verify", "--tree", "a".repeat(40)]]) {
    const run = spawnSync(process.execPath, ["scripts/release-production.mjs", ...args], { encoding: "utf8", input: "" });
    assert.equal(run.status, 1, `exit status for: ${args.join(" ") || "(none)"}`);
    assert.match(run.stderr, /STOP/u);
  }
});
