import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const html = readFileSync(join(root, "index.html"), "utf8");

test("production_markup_has_no_fictional_student_names", () => {
  assert.doesNotMatch(html, /\b(Mariam|Omar|Youssef|Salma|Ahmed|Nour|Karim|Laila|Tarek|Habiba)\b/);
  for (const match of html.matchAll(/id="name-[123]">([^<]*)</g)) assert.equal(match[1], "—");
});

test("campus_wins_composer_has_no_free_text_field", () => {
  assert.doesNotMatch(html, /<textarea\b/i);
  assert.doesNotMatch(html, /achievement-note/);
});

test("login_interface_uses_username_password_without_provider_email_fields", () => {
  assert.match(html, /id="login-username"[^>]*name="username"/);
  assert.match(html, /id="login-password"[^>]*type="password"/);
  assert.doesNotMatch(html, /type="email"|name="email"|supabase\.co|@supabase\/supabase-js/i);
  assert.doesNotMatch(html, /CREATE ACCOUNT|REGISTER|SIGN UP/i);
});

test("leaderboard_and_wins_have_live_status_regions", () => {
  assert.match(html, /id="ranking-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="wins-status"[^>]*role="status"[^>]*aria-live="polite"/);
});

test("frontend_loads_runtime_config_and_data_access_without_pilot_adapter", () => {
  const runtime = html.indexOf("assets/runtime-config.js");
  const dataAccess = html.indexOf("assets/data-access.js");
  const app = html.indexOf("assets/app.js");
  assert.ok(runtime >= 0 && runtime < dataAccess && dataAccess < app);
  assert.doesNotMatch(html, /assets\/server-adapter\.js/);
});

test("static_markup_has_no_inline_script_or_style_blocks", () => {
  assert.doesNotMatch(html, /\sstyle=/i);
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i);
});

test("release_a_student_status_panel_and_board_keep_the_chosen_look", () => {
  const app = readFileSync(join(root, "assets/app.js"), "utf8");
  // The studio states come from the server; "public" is never set in the browser.
  assert.match(html, /id="publication-state"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
  for (const state of ["not_saved", "saved_private", "display_off", "awaiting_link", "public", "unknown"]) {
    assert.match(app, new RegExp(`\\b${state}: \\[`), `copy exists for ${state}`);
  }
  assert.doesNotMatch(app, /publicationState = "public"/, "the browser never upgrades the state to public");
  assert.match(app, /publicationState = result\.avatar \? result\.publication : "unknown";/);
  assert.match(app, /const epoch = sessionEpoch;\n    try {\n      const publicChoice/, "a save result is dropped after a session change");
  // Personalized rows keep the saved style; reviewed defaults stay 3D.
  assert.match(app, /const boardStyle = \(row\) => \(row\.personalized \? row\.style : "cartoon3d"\);/);
  assert.doesNotMatch(app, /anonymous illustration/, "opt-out copy matches the reviewed default characters");
  assert.doesNotMatch(html, /Leaderboards always show your character in the 3D Cartoon style/);
});
