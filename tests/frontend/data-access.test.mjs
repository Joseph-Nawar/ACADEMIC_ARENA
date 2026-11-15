import assert from "node:assert/strict";
import test from "node:test";
import "../../assets/data-access.js";

const { createArenaDataAccess } = globalThis.AcademicArenaDataAccess;

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
          displayName: "Fictional Student",
          role: "student",
          mustChangePassword: true,
          email: "fictional@student.invalid",
          id: "private-user-id",
        },
        csrfToken: "csrf-fixture-token",
        access_token: "fake-provider-token",
        refresh_token: "fake-provider-refresh",
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
    user: { displayName: "Fictional Student", role: "student", mustChangePassword: true },
  });
  assert.equal(JSON.stringify(result).includes("email"), false);
  assert.equal(JSON.stringify(result).includes("token"), false);
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
