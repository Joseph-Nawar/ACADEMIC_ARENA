import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.AA_SUPABASE_URL;
const anonKey = process.env.AA_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.AA_SUPABASE_SERVICE_ROLE_KEY;

function required(value, name) {
  assert.ok(value, `${name} is supplied only by npm run test:m2:local`);
  return value;
}

async function json(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function apiRequest(path, { method = "GET", token = anonKey, body, prefer, profile = "public" } = {}) {
  const headers = {
    apikey: required(anonKey, "local anonymous key"),
    Authorization: `Bearer ${required(token, "local request token")}`,
    Accept: "application/json",
    "Accept-Profile": profile,
    "Content-Profile": profile,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  return fetch(new URL(`/rest/v1/${path}`, required(baseUrl, "local Supabase URL")), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createFixtureUser(context, label) {
  const email = `${label}-${crypto.randomUUID()}@academic-arena.test`;
  const password = `${crypto.randomUUID()}Aa!`;
  const key = required(serviceRoleKey, "local service role key");
  const adminHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const response = await fetch(new URL("/auth/v1/admin/users", baseUrl), {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  assert.ok(response.ok, `local fictional Auth user creation failed with HTTP ${response.status}`);
  const providerUser = await response.json();
  assert.equal(providerUser.email, email);
  context.after(async () => {
    const deleted = await fetch(new URL(`/auth/v1/admin/users/${encodeURIComponent(providerUser.id)}`, baseUrl), {
      method: "DELETE",
      headers: adminHeaders,
    });
    assert.ok(deleted.ok, `local fictional Auth identity cleanup failed with HTTP ${deleted.status}`);
  });

  const username = `${label}.${crypto.randomUUID().slice(0, 8)}`;
  const provisioned = await apiRequest("rpc/provision_account", {
    method: "POST",
    token: key,
    body: {
      p_provider_user_id: providerUser.id,
      p_username: username,
      p_provider_email: email,
    },
  });
  assert.ok(provisioned.ok, `local server-only account provisioning failed with HTTP ${provisioned.status}`);
  const accountId = await json(provisioned);
  assert.match(accountId, /^[0-9a-f-]{36}$/i, "internal account ID remains in test/server code");

  const login = await fetch(new URL("/auth/v1/token?grant_type=password", baseUrl), {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(login.ok, `local fictional password sign-in failed with HTTP ${login.status}`);
  const providerSession = await login.json();
  assert.equal(providerSession.user.email, email);
  assert.equal(typeof providerSession.access_token, "string");
  assert.equal(typeof providerSession.refresh_token, "string");

  return { accountId, accessToken: providerSession.access_token };
}

test("local PostgREST enforces avatar ownership and exposes only public projection fields", async (context) => {
  required(baseUrl, "local Supabase URL");
  const first = await createFixtureUser(context, "rls-first");
  const second = await createFixtureUser(context, "rls-second");

  const created = await apiRequest("student_avatar_configs?select=character_key,family,tone,badge", {
    method: "POST",
    token: first.accessToken,
    body: { character_key: "amara", family: "ink", tone: "mint", badge: "✦" },
  });
  const avatarCreateError = created.ok ? null : await json(created.clone());
  assert.equal(created.status, 201, `owner can create their avatar without supplying an account ID (database code: ${avatarCreateError?.code || "none"})`);

  const firstRowsResponse = await apiRequest("student_avatar_configs?select=character_key,family,tone,badge", {
    token: first.accessToken,
  });
  const secondRowsResponse = await apiRequest("student_avatar_configs?select=character_key,family,tone,badge", {
    token: second.accessToken,
  });
  assert.ok(firstRowsResponse.ok && secondRowsResponse.ok);
  const firstRows = await json(firstRowsResponse);
  const avatar = firstRows[0];
  assert.deepEqual(Object.keys(avatar).sort(), ["badge", "character_key", "family", "tone"]);
  assert.deepEqual(avatar, { character_key: "amara", family: "ink", tone: "mint", badge: "✦" });
  assert.equal(firstRows.length, 1, "student sees their own avatar");
  assert.deepEqual(await json(secondRowsResponse), [], "another student sees no avatar rows");

  const anonymousAvatarRead = await apiRequest("student_avatar_configs?select=character_key,family,tone,badge");
  assert.ok(!anonymousAvatarRead.ok, "anonymous visitors cannot query private avatar configurations");

  const crossAccountUpdate = await apiRequest(`student_avatar_configs?account_id=eq.${first.accountId}`, {
    method: "PATCH",
    token: second.accessToken,
    body: { character_key: "omar" },
  });
  assert.ok(crossAccountUpdate.ok || [401, 403].includes(crossAccountUpdate.status),
    "a cross-account avatar update is rejected or filtered to zero rows");
  const afterCrossAccountUpdate = await apiRequest("student_avatar_configs?select=character_key,family,tone,badge", {
    token: first.accessToken,
  });
  assert.deepEqual(await json(afterCrossAccountUpdate), [avatar], "cross-account update leaves the owner's avatar unchanged");

  const accountColumn = await apiRequest("student_avatar_configs?select=account_id", {
    token: first.accessToken,
  });
  assert.ok(!accountColumn.ok, "PostgREST denies selecting the private owner key");

  const roleRead = await apiRequest("account_role_grants?select=*", { profile: "app_private" });
  assert.ok(!roleRead.ok, "private role schema is not exposed through PostgREST");
  const sessionRead = await apiRequest("bff_sessions?select=*", { profile: "app_private" });
  assert.ok(!sessionRead.ok, "private session records are not exposed through PostgREST");

  const escalation = await apiRequest("rpc/provision_account", {
    method: "POST",
    token: first.accessToken,
    body: {
      p_provider_user_id: crypto.randomUUID(),
      p_username: `student.escalation.${crypto.randomUUID().slice(0, 8)}`,
      p_provider_email: `escalation-${crypto.randomUUID()}@academic-arena.test`,
    },
  });
  assert.ok(!escalation.ok, "student JWT cannot invoke the service-only provisioning function");

  const snapshotId = crypto.randomUUID();
  const version = 800000 + Math.floor(Math.random() * 100000);
  const serviceKey = required(serviceRoleKey, "local service role key");
  context.after(async () => {
    const deleted = await apiRequest(`published_leaderboard_snapshots?id=eq.${snapshotId}`, {
      method: "DELETE",
      token: serviceKey,
    });
    assert.ok(deleted.ok, "local public snapshot fixture cleanup succeeds");
  });

  const snapshotInsert = await apiRequest("published_leaderboard_snapshots", {
    method: "POST",
    token: serviceKey,
    body: { id: snapshotId, version_number: version, academic_year: "fictional-2026", published_at: new Date().toISOString(), is_current: true },
  });
  assert.equal(snapshotInsert.status, 201, "local server fixture can add an approved public snapshot");
  const boardInsert = await apiRequest("published_leaderboard_rows", {
    method: "POST",
    token: serviceKey,
    body: {
      snapshot_id: snapshotId,
      level: 5,
      semester: 1,
      cohort_key: "core",
      board_kind: "semester",
      module_key: null,
      position: 1,
      public_name: "Fictional Learner",
      avatar_key: "amara",
      avatar_family: "ink",
    },
  });
  assert.equal(boardInsert.status, 201);
  const publicRowsResponse = await apiRequest("published_leaderboard_rows?select=*&level=eq.5&semester=eq.1&cohort_key=eq.core&board_kind=eq.semester&module_key=is.null");
  assert.ok(publicRowsResponse.ok);
  const publicRows = await json(publicRowsResponse);
  assert.equal(publicRows.length, 1);
  assert.deepEqual(Object.keys(publicRows[0]).sort(), [
    "avatar_family", "avatar_key", "board_kind", "cohort_key", "level", "module_key",
    "position", "public_name", "semester", "snapshot_id",
  ]);
  assert.equal(JSON.stringify(publicRows).includes("Fictional Learner"), true);
  for (const forbidden of ["account_id", "student_id", "provider_email", "grade", "score", "attendance", "access_token", "refresh_token"]) {
    assert.equal(Object.hasOwn(publicRows[0], forbidden), false, `public leaderboard has no ${forbidden} field`);
  }

  const publicWinsResponse = await apiRequest("campus_wins_public?select=*");
  assert.ok(publicWinsResponse.ok);
  const publicWins = await json(publicWinsResponse);
  assert.deepEqual(publicWins, [], "unpublished or unapproved Campus Wins records are not public");
});
