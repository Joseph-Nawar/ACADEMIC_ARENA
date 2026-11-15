import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const buildScript = join(root, "scripts", "build.mjs");

function build(mode) {
  const outDir = mkdtempSync(join(root, ".test-build-"));
  const result = spawnSync(process.execPath, [buildScript, "--mode=" + mode, "--out-dir", outDir], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { outDir, config() {
    const source = readFileSync(join(outDir, "assets", "runtime-config.js"), "utf8");
    const match = source.match(/window\.ARENA_CONFIG\s*=\s*Object\.freeze\((.+)\);/);
    assert.ok(match, "runtime config must be one JSON object");
    return JSON.parse(match[1]);
  } };
}

test("production_build_excludes_fixtures_and_pilot_backend", () => {
  const result = build("production");
  try {
    assert.equal(existsSync(join(result.outDir, "index.html")), true);
    assert.equal(existsSync(join(result.outDir, "_headers")), true);
    assert.equal(existsSync(join(result.outDir, "arena")), false);
    assert.equal(existsSync(join(result.outDir, "fixtures")), false);
    assert.equal(existsSync(join(result.outDir, "data")), false);
    assert.equal(existsSync(join(result.outDir, "assets", "server-adapter.js")), false);
  } finally {
    rmSync(result.outDir, { recursive: true, force: true });
  }
});

test("build_modes_write_explicit_runtime_config", () => {
  for (const mode of ["demo", "production"]) {
    const result = build(mode);
    try {
      assert.deepEqual(result.config(), { mode, apiBase: "/api" });
    } finally {
      rmSync(result.outDir, { recursive: true, force: true });
    }
  }
});

test("pages_headers_set_security_and_revalidation", () => {
  const result = build("production");
  try {
    const headers = readFileSync(join(result.outDir, "_headers"), "utf8");
    assert.match(headers, /Content-Security-Policy: default-src 'self'/);
    assert.match(headers, /X-Content-Type-Options: nosniff/);
    assert.match(headers, /Cache-Control: no-cache/);
    assert.match(headers, /frame-ancestors 'none'/);
  } finally {
    rmSync(result.outDir, { recursive: true, force: true });
  }
});
