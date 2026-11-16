import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const buildScript = join(root, "scripts", "build.mjs");

function build(mode, { allowDemo = false, env = process.env } = {}) {
  const outDir = mkdtempSync(join(root, ".test-build-"));
  const args = [buildScript, "--mode=" + mode];
  if (allowDemo) args.push("--allow-demo-output");
  args.push("--out-dir", outDir);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
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
    assert.equal(existsSync(join(result.outDir, "assets", "source")), false);
    for (const legacy of ["laila.jpg", "ahmed.jpg", "mariam.png", "omar.png", "youssef.png"]) {
      assert.equal(existsSync(join(result.outDir, "assets", legacy)), false);
    }
  } finally {
    rmSync(result.outDir, { recursive: true, force: true });
  }
});

test("pages_bundle_includes_eue_branding_and_both_approved_character_families", () => {
  const result = build("production");
  try {
    for (const file of [
      "assets/eue-wordmark-draft.svg",
      "assets/characters/amara-ink.png",
      "assets/characters/amara-3d.png",
      "assets/characters/amara-face.png",
      "assets/characters/amara-3d-face.jpg",
    ]) assert.equal(existsSync(join(result.outDir, file)), true, file + " must be in the Pages bundle");
  } finally {
    rmSync(result.outDir, { recursive: true, force: true });
  }
});

test("production_static_assets_exclude_fictional_student_records", () => {
  const result = build("production");
  try {
    const publicText = ["index.html", "assets/app.js", "assets/data-access.js", "assets/runtime-config.js"]
      .map((file) => readFileSync(join(result.outDir, file), "utf8"))
      .join("\n");
    assert.doesNotMatch(publicText, /\b(Mariam|Omar|Youssef|Salma|Ahmed|Nour|Karim|Laila|Tarek|Habiba)\b/);
  } finally {
    rmSync(result.outDir, { recursive: true, force: true });
  }
});

test("build_modes_write_explicit_runtime_config", () => {
  for (const mode of ["demo", "production"]) {
    const result = build(mode, { allowDemo: mode === "demo" });
    try {
      assert.deepEqual(result.config(), { mode, apiBase: "/api" });
    } finally {
      rmSync(result.outDir, { recursive: true, force: true });
    }
  }
});

test("demo_build_requires_explicit_opt_in_and_is_rejected_by_cloudflare_pages", () => {
  const local = spawnSync(process.execPath, [buildScript, "--mode=demo"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(local.status, 0, "demo output must require an explicit local opt-in");
  assert.match(local.stderr, /explicit local demo opt-in/i);

  const cloudflare = spawnSync(process.execPath, [buildScript, "--mode=demo", "--allow-demo-output"], {
    cwd: root,
    env: { ...process.env, CF_PAGES: "1" },
    encoding: "utf8",
  });
  assert.notEqual(cloudflare.status, 0, "Cloudflare Pages must reject demo output even with the local opt-in");
  assert.match(cloudflare.stderr, /demo builds are disabled on cloudflare pages/i);
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
