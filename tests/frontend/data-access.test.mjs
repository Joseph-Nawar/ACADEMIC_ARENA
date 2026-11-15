import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import "../../assets/data-access.js";

const { createArenaDataAccess } = globalThis.AcademicArenaDataAccess;
const root = fileURLToPath(new URL("../../", import.meta.url));
const demoFixture = JSON.parse(readFileSync(join(root, "fixtures/demo/academic-arena.json"), "utf8"));

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test("public_board_query_encodes_all_filters_and_allowlists_rows", async () => {
  let observed;
  const api = createArenaDataAccess({
    mode: "production",
    fetchImpl: async (url, options) => {
      observed = { url: new URL(url, "https://arena.test"), options };
      return response({
        rows: [{
          position: 1,
          name: "Fictional Student",
          avatar: "amara",
          style: "cartoon3d",
          student_id: "fictional-private-key",
          grade: 99,
        }],
        internal_version_id: "private-version",
      });
    },
  });

  const result = await api.public.getLeaderboard({
    level: "6",
    semester: "2",
    group: "advanced track",
    kind: "module",
    module: "CS/415",
  });

  assert.equal(observed.url.pathname, "/api/public/leaderboards");
  assert.deepEqual(Object.fromEntries(observed.url.searchParams), {
    level: "6",
    semester: "2",
    group: "advanced track",
    kind: "module",
    module: "CS/415",
  });
  assert.equal(observed.options.credentials, "same-origin");
  assert.deepEqual(result, {
    state: "ok",
    publishedAt: null,
    rows: [{ position: 1, name: "Fictional Student", avatar: "amara", style: "cartoon3d" }],
  });
});

test("production_failure_never_falls_back_to_fixture", async () => {
  const requests = [];
  const api = createArenaDataAccess({
    mode: "production",
    fetchImpl: async (url) => {
      requests.push(String(url));
      throw new Error("network offline");
    },
  });

  const result = await api.public.getLeaderboard({
    level: "5",
    semester: "1",
    group: "core",
    kind: "semester",
    module: "",
  });

  assert.equal(result.state, "unavailable");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(requests, ["/api/public/leaderboards?level=5&semester=1&group=core&kind=semester&module="]);
});

test("missing_runtime_config_defaults_to_production_without_loading_fixtures", async () => {
  const previous = globalThis.ARENA_CONFIG;
  delete globalThis.ARENA_CONFIG;
  const requests = [];
  try {
    const api = createArenaDataAccess({
      fetchImpl: async (url) => {
        requests.push(String(url));
        throw new Error("backend unavailable");
      },
    });
    const result = await api.public.getLeaderboard({
      level: "5", semester: "1", group: "core", kind: "semester", module: "",
    });
    assert.equal(api.mode, "production");
    assert.equal(result.state, "unavailable");
    assert.equal(requests.every((url) => url.startsWith("/api/")), true);
  } finally {
    if (previous === undefined) delete globalThis.ARENA_CONFIG;
    else globalThis.ARENA_CONFIG = previous;
  }
});

test("empty_public_responses_are_distinct_from_backend_unavailability", async () => {
  const api = createArenaDataAccess({
    mode: "production",
    fetchImpl: async () => response({ rows: [], posts: [] }),
  });
  const board = await api.public.getLeaderboard({
    level: "5", semester: "1", group: "core", kind: "semester", module: "",
  });
  const wins = await api.public.getWins("all");
  assert.deepEqual(board, { state: "empty", publishedAt: null, rows: [] });
  assert.deepEqual(wins, { state: "empty", posts: [] });
});

test("campus_wins_public_shape_excludes_private_and_free_text_fields", async () => {
  const api = createArenaDataAccess({
    mode: "production",
    fetchImpl: async () => response({
      posts: [{
        id: "post-1",
        author: "Fictional Student",
        avatar: "mariam",
        style: "ink",
        type: "project",
        created: "2026-11-15",
        counts: [2, 3, 4],
        note: "unapproved free text",
        status: "pending",
        author_id: "private-account-id",
        email: "private@example.invalid",
      }],
    }),
  });

  const result = await api.public.getWins("all");
  assert.equal(result.state, "ok");
  assert.deepEqual(result.posts, [{
    id: "post-1",
    author: "Fictional Student",
    avatar: "mariam",
    style: "ink",
    type: "project",
    category: "academic",
    created: "2026-11-15",
    counts: [2, 3, 4],
    myReaction: null,
  }]);
});

test("login_uses_same_origin_and_returns_only_sanitized_session", async () => {
  let observed;
  const api = createArenaDataAccess({
    mode: "production",
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return response({
        authenticated: true,
        user: {
          role: "student",
          mustChangePassword: true,
        },
        csrfToken: "csrf-fixture-token",
      });
    },
  });

  const result = await api.auth.signIn({
    username: "fictional-student",
    password: "fictional-only-password",
  });

  assert.equal(observed.url, "/api/auth/login");
  assert.equal(observed.options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(observed.options.body), {
    username: "fictional-student",
    password: "fictional-only-password",
  });
  assert.deepEqual(result, {
    authenticated: true,
    user: { role: "student", mustChangePassword: true },
  });
  assert.equal(JSON.stringify(result).includes("email"), false);
  assert.equal(JSON.stringify(result).includes("token"), false);
  assert.equal(JSON.stringify(observed).includes("@"), false);
});

test("login_uses_the_same_generic_error_for_unknown_and_throttled_accounts", async () => {
  async function failureMessage(status) {
    const api = createArenaDataAccess({
      mode: "production",
      fetchImpl: async () => response({}, status),
    });
    let caught;
    try {
      await api.auth.signIn({ username: "fictional-user", password: "fictional-password" });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof Error);
    assert.equal(caught.message, "Could not sign you in. Check your details or try again later.");
    return caught.message;
  }

  assert.equal(await failureMessage(401), "Could not sign you in. Check your details or try again later.");
  assert.equal(await failureMessage(429), "Could not sign you in. Check your details or try again later.");
});

test("student_and_staff_writes_do_not_accept_client_roles", async () => {
  const calls = [];
  const api = createArenaDataAccess({
    mode: "production",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ ok: true });
    },
  });

  await api.student.saveCharacter({
    base: "amara",
    style: "cartoon3d",
    tone: "mint",
    badge: "✦",
    role: "admin",
    student_id: "another-fictional-user",
  });
  await api.student.submitAchievement({ type: "project", note: "free text must not pass" });
  await api.staff.moderateCampusWin("post-1", "approved");
  await api.staff.publishLeaderboard("candidate-1");
  await api.staff.provisionStudent({ username: "fictional-student", temporaryPassword: "fictional-password" });

  const avatarBody = JSON.parse(calls[0].options.body);
  assert.deepEqual(avatarBody, { avatar: { base: "amara", style: "cartoon3d", tone: "mint", badge: "✦" } });
  assert.deepEqual(JSON.parse(calls[1].options.body), { type: "project" });
  assert.deepEqual(JSON.parse(calls[2].options.body), { decision: "approved" });
  assert.deepEqual(JSON.parse(calls[3].options.body), { publicationId: "candidate-1" });
  assert.deepEqual(JSON.parse(calls[4].options.body), {
    username: "fictional-student",
    temporaryPassword: "fictional-password",
  });
  assert.equal(calls.every((call) => call.options.credentials === "same-origin"), true);
});

test("demo_avatar_settings_are_owned_by_the_current_preview_account", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const api = createArenaDataAccess({
    mode: "demo",
    fetchImpl: async () => response(demoFixture),
    storage,
  });
  const avatar = { base: "amara", style: "cartoon3d", tone: "coral", badge: "★" };

  assert.equal(await api.student.getMyCharacter(), null);
  await api.student.saveCharacter({ ...avatar, role: "admin", account_id: "fictional-other-account" });
  assert.deepEqual(await api.student.getMyCharacter(), avatar);
});

test("demo_leaderboard_fixture_changes_with_level_semester_and_module_filters", async () => {
  const api = createArenaDataAccess({ mode: "demo", fetchImpl: async () => response(demoFixture) });
  const filters = { level: "5", semester: "1", group: "core", kind: "semester", module: "" };
  const names = async (overrides = {}) => (await api.public.getLeaderboard({ ...filters, ...overrides }))
    .rows.map((row) => row.name).join(",");
  const baseline = await names();
  const variants = [
    await names({ level: "4" }),
    await names({ level: "6" }),
    await names({ semester: "2" }),
    await names({ kind: "module", module: "module-a" }),
    await names({ kind: "module", module: "module-b" }),
    await names({ kind: "module", module: "module-c" }),
  ];
  assert.equal(new Set([baseline, ...variants]).size, 7);
});

test("demo_reactions_toggle_one_active_reaction_and_update_counts", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const api = createArenaDataAccess({
    mode: "demo",
    fetchImpl: async () => response(demoFixture),
    storage,
  });

  const initial = (await api.public.getWins("all")).posts[0];
  assert.deepEqual(initial.counts, [42, 18, 11]);
  await api.student.setReaction("demo-win-1", "heart");
  const heart = (await api.public.getWins("all")).posts[0];
  assert.deepEqual(heart.counts, [43, 18, 11]);
  assert.equal(heart.myReaction, "heart");

  await api.student.setReaction("demo-win-1", "clap");
  const clap = (await api.public.getWins("all")).posts[0];
  assert.deepEqual(clap.counts, [42, 19, 11]);
  assert.equal(clap.myReaction, "clap");

  await api.student.setReaction("demo-win-1", "clap");
  const cleared = (await api.public.getWins("all")).posts[0];
  assert.deepEqual(cleared.counts, [42, 18, 11]);
  assert.equal(cleared.myReaction, null);
});
