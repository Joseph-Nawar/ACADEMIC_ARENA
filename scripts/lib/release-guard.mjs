// Fail-closed checks that run before anything touches production. Every check
// that cannot be completed counts as a failure. Returns a list of problems;
// an empty list means the checkout is exactly the reviewed code.
import { spawnSync } from "node:child_process";

const HEX40 = /^[0-9a-f]{40}$/u;
// Build output and caches are expected; anything else ignored by git (.dev.vars,
// .env, private data files) could change a build, so it blocks the release.
// supabase/.temp holds only the linked project ref, written by `supabase link`.
const ALLOWED_IGNORED = [/^node_modules\//u, /^dist\//u, /^\.wrangler\//u, /^test-results\//u, /^supabase\/\.temp\//u];

export function git(cwd, args, { raw = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  const out = result.stdout || "";
  return { ok: result.status === 0, out: raw ? out : out.trim() };
}

function defaultCi(cwd, commit) {
  const remote = git(cwd, ["remote", "get-url", "origin"]);
  const repo = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/u.exec(remote.out)?.[1];
  if (!remote.ok || !repo) return { ok: false, reason: "cannot tell which GitHub repository origin is" };
  const result = spawnSync("gh", ["api", `repos/${repo}/commits/${commit}/check-runs`, "--paginate", "--jq", ".check_runs[] | [.name, .status, .conclusion] | @tsv"], { cwd, encoding: "utf8" });
  if (result.status !== 0) return { ok: false, reason: "cannot read CI results from GitHub (is gh signed in?)" };
  return { ok: true, runs: result.stdout.split("\n").filter(Boolean).map((line) => line.split("\t")) };
}

/**
 * @param {object} options
 * @param {string} options.cwd             the checkout to verify
 * @param {string} options.expectedTree    40-hex tree id of the reviewed code (from the release report)
 * @param {string} [options.expectedCommit] 40-hex commit id, when it is known in advance
 * @param {boolean} [options.fetch=true]   compare with a freshly fetched origin/main
 * @param {boolean} [options.requireMain=true]
 * @param {boolean} [options.requireCi=true]
 * @param {(cwd: string, commit: string) => {ok: boolean, reason?: string, runs?: string[][]}} [options.ci]
 */
export function checkRelease({ cwd, expectedTree, expectedCommit, fetch = true, requireMain = true, requireCi = true, ci = defaultCi }) {
  const problems = [];
  if (!HEX40.test(String(expectedTree || ""))) return ["the expected tree id must be 40 lowercase hex characters"];
  if (expectedCommit !== undefined && !HEX40.test(expectedCommit)) return ["the expected commit id must be 40 lowercase hex characters"];
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return ["not inside a git checkout"];
  const head = git(cwd, ["rev-parse", "HEAD"]);
  const tree = git(cwd, ["rev-parse", "HEAD^{tree}"]);
  if (!head.ok || !tree.ok) return ["cannot read HEAD"];

  if (tree.out !== expectedTree) problems.push(`the checked-out code is not the reviewed code (tree ${tree.out.slice(0, 12)}…, expected ${expectedTree.slice(0, 12)}…)`);
  if (expectedCommit && head.out !== expectedCommit) problems.push(`HEAD is ${head.out.slice(0, 12)}…, expected ${expectedCommit.slice(0, 12)}…`);

  const status = git(cwd, ["status", "--porcelain=v1", "--ignored=traditional", "--untracked-files=all"], { raw: true });
  if (!status.ok) problems.push("cannot read the working tree status");
  else for (const line of status.out.split("\n").filter(Boolean)) {
    const flag = line.slice(0, 2);
    const file = line.slice(3);
    if (flag === "!!" && ALLOWED_IGNORED.some((pattern) => pattern.test(file))) continue;
    problems.push(`${flag === "!!" ? "ignored file present" : flag === "??" ? "untracked file" : "modified file"}: ${file}`);
  }

  if (requireMain) {
    const branch = git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
    if (branch.out !== "main") problems.push(`not on the main branch (${branch.out || "detached HEAD"})`);
    if (fetch) {
      const fetched = git(cwd, ["fetch", "--quiet", "origin", "main"]);
      const remote = git(cwd, ["rev-parse", "origin/main"]);
      if (!fetched.ok || !remote.ok) problems.push("cannot fetch origin/main to compare");
      else if (remote.out !== head.out) problems.push("HEAD is not the current origin/main");
    }
  }

  if (requireCi) {
    const result = ci(cwd, head.out);
    if (!result.ok) problems.push(result.reason);
    else if (result.runs.length < 2) problems.push(`CI has reported ${result.runs.length} check(s) for this commit; expected at least 2`);
    else for (const [name, state, conclusion] of result.runs) {
      if (state !== "completed" || conclusion !== "success") problems.push(`CI check "${name}" is ${state === "completed" ? conclusion : state}`);
    }
  }
  return problems;
}
