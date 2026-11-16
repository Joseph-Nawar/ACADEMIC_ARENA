import assert from "node:assert/strict";
import test from "node:test";
import { sessionCookie as formatSessionCookie } from "../../functions/lib/response.js";
import { revokeProviderRefreshToken } from "../../functions/lib/provider.js";
import { api, createIdentity, createServerSession, json, local, randomOpaqueToken, serviceRpc, sessionCookie } from "./bff-fixtures.mjs";

function assertNoProviderSecrets(payload, identity) {
  const serialized = JSON.stringify(payload);
  for (const value of [
    identity.email,
    identity.providerSession.access_token,
    identity.providerSession.refresh_token,
    local.serviceRoleKey,
  ]) {
    assert.equal(serialized.includes(value), false, "BFF response contains no email, provider tokens, or service key");
  }
  for (const key of ["email", "access_token", "refresh_token", "provider_user_id", "account_id", "session_id", "service_role_key"]) {
    assert.equal(Object.hasOwn(payload, key), false, `BFF response has no ${key} field`);
  }
}

test("issued opaque session cookies use the required host-only security attributes", () => {
  const value = randomOpaqueToken();
  const cookie = formatSessionCookie(value, 3600);
  assert.match(cookie, new RegExp(`^__Host-aa_session=${value}; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Strict$`, "u"));
  assert.doesNotMatch(cookie, /Domain=/iu);
});

test("unauthenticated session response is no-store and contains no identity details", async () => {
  const response = await api("/api/auth/session");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/u);
  assert.match(response.headers.get("vary") || "", /cookie/iu);
  assert.deepEqual(await json(response), { authenticated: false });
});

test("local Supabase session is resolved from an opaque cookie and returns an allowlisted session", async (context) => {
  const identity = await createIdentity(context, "session-student");
  const session = await createServerSession(context, identity);
  const response = await api("/api/auth/session", {
    headers: { Cookie: sessionCookie(session.sessionToken) },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/u);
  const payload = await json(response);
  assert.deepEqual(payload, {
    authenticated: true,
    user: { role: "student", mustChangePassword: true },
    csrfToken: session.csrfToken,
  });
  assertNoProviderSecrets(payload, identity);
});

test("unknown and expired opaque session cookies fail closed", async (context) => {
  const unknown = await api("/api/auth/session", {
    headers: { Cookie: sessionCookie(randomOpaqueToken()) },
  });
  assert.equal(unknown.status, 200);
  assert.deepEqual(await json(unknown), { authenticated: false });
  assert.match(unknown.headers.get("set-cookie") || "", /Max-Age=0/iu);

  const malformed = await api("/api/auth/session", {
    headers: { Cookie: sessionCookie(crypto.randomUUID()) },
  });
  assert.equal(malformed.status, 200);
  assert.deepEqual(await json(malformed), { authenticated: false });

  const identity = await createIdentity(context, "expired-session");
  const session = await createServerSession(context, identity, { expiresInMs: 2_000 });
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  const expired = await api("/api/auth/session", {
    headers: { Cookie: sessionCookie(session.sessionToken) },
  });
  assert.equal(expired.status, 200);
  assert.deepEqual(await json(expired), { authenticated: false });
});

test("parallel requests share one opaque server-side session without exposing provider credentials", async (context) => {
  const identity = await createIdentity(context, "parallel-session");
  const session = await createServerSession(context, identity);
  const responses = await Promise.all(Array.from({ length: 12 }, () => api("/api/auth/session", {
    headers: { Cookie: sessionCookie(session.sessionToken) },
  })));
  assert.ok(responses.every((response) => response.status === 200));
  const payloads = await Promise.all(responses.map(json));
  assert.ok(payloads.every((payload) => payload.authenticated === true));
  for (const payload of payloads) assertNoProviderSecrets(payload, identity);
});

test("provider logout revokes refresh credentials while an existing JWT stays acceptable to PostgREST until expiry", async (context) => {
  const identity = await createIdentity(context, "provider-revocation");
  const completed = await serviceRpc("complete_password_change", { p_account_id: identity.accountId });
  assert.ok(completed.ok, "local fictional account has completed initial password setup before testing RLS token validity");
  assert.equal(typeof identity.providerSession.refresh_token, "string");
  assert.ok(identity.providerSession.refresh_token.length > 0, "fictional provider returns a nonempty refresh credential");
  const avatarWrite = await fetch(new URL("/rest/v1/rpc/save_own_avatar_config", local.supabaseUrl), {
    method: "POST",
    headers: {
      apikey: local.anonKey,
      Authorization: `Bearer ${identity.providerSession.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_character_key: "amara", p_family: "ink", p_tone: "mint", p_badge: "✦" }),
  });
  assert.equal(avatarWrite.status, 200, "provider JWT can invoke the authenticated owner-derived write before sign-out");
  assert.equal(await avatarWrite.json(), true);

  const providerRevoked = await revokeProviderRefreshToken({
    ENVIRONMENT: "test",
    SUPABASE_URL: local.supabaseUrl,
    SUPABASE_ANON_KEY: local.anonKey,
    SESSION_JWE_KEY: local.jweKey,
    RATE_LIMIT_HMAC_KEY: process.env.AA_RATE_LIMIT_HMAC_KEY,
  }, identity.providerSession.access_token, identity.providerSession.refresh_token);
  assert.equal(providerRevoked, true, "local Supabase acknowledges revocation of this provider session");

  const refreshAttempt = await fetch(new URL("/auth/v1/token?grant_type=refresh_token", local.supabaseUrl), {
    method: "POST",
    headers: { apikey: local.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: identity.providerSession.refresh_token }),
  });
  assert.ok(refreshAttempt.status >= 400, `the logged-out provider refresh credential cannot be reused (HTTP ${refreshAttempt.status})`);

  const accessAttempt = await fetch(new URL("/rest/v1/student_avatar_configs?select=character_key,family,tone,badge", local.supabaseUrl), {
    headers: {
      apikey: local.anonKey,
      Authorization: `Bearer ${identity.providerSession.access_token}`,
      "Accept-Profile": "public",
      "Content-Profile": "public",
    },
  });
  assert.equal(accessAttempt.status, 200, "the existing JWT remains acceptable to PostgREST until its short expiry");
  assert.deepEqual(await accessAttempt.json(), [{ character_key: "amara", family: "ink", tone: "mint", badge: "✦" }]);
});
