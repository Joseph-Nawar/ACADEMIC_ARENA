import assert from "node:assert/strict";
import test from "node:test";
import { api, createIdentity, hashToken, json, local, serviceRpc, setFictionalAccountStatus, toPostgresBytea } from "./bff-fixtures.mjs";

const origin = new URL(local.pagesUrl).origin;

function cookieValue(response) {
  const cookie = response.headers.get("set-cookie") || "";
  assert.match(cookie, /^__Host-aa_session=[A-Za-z0-9_-]{43};/u);
  assert.match(cookie, /; Secure; HttpOnly; SameSite=Strict$/u);
  assert.match(cookie, /; Path=\//u);
  assert.doesNotMatch(cookie, /Domain=/iu);
  const value = cookie.split(";", 1)[0].slice("__Host-aa_session=".length);
  return { cookie: `__Host-aa_session=${value}`, value };
}

test("fictional username login creates only an opaque cookie and an allowlisted session", async (context) => {
  const identity = await createIdentity(context, "login-success");
  const response = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": "192.0.2.10" },
    body: { username: identity.username, password: identity.password },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/u);
  const session = await json(response);
  assert.equal(session.authenticated, true);
  assert.deepEqual(session.user, { role: "student", mustChangePassword: true });
  assert.match(session.csrfToken, /^[A-Za-z0-9_-]{43}$/u);
  const serialized = JSON.stringify(session);
  for (const value of [identity.email, identity.providerSession.access_token, identity.providerSession.refresh_token, local.serviceRoleKey]) {
    assert.equal(serialized.includes(value), false, "login response contains no provider/private credential");
  }
  for (const field of ["email", "access_token", "refresh_token", "provider_user_id", "account_id", "session_id"]) {
    assert.equal(Object.hasOwn(session, field), false, `login response omits ${field}`);
  }

  const issued = cookieValue(response);
  const storedSessionResponse = await serviceRpc("resolve_bff_session", {
    p_session_token_hash: toPostgresBytea(await hashToken(issued.value)),
  });
  assert.ok(storedSessionResponse.ok, "private BFF session can be resolved only by the server role");
  const storedSessionRows = await json(storedSessionResponse);
  const storedSession = Array.isArray(storedSessionRows) ? storedSessionRows[0] : storedSessionRows;
  assert.match(storedSession.provider_access_token_jwe, /^eyJ/u);
  assert.match(storedSession.provider_refresh_token_jwe, /^eyJ/u);
  assert.match(storedSession.csrf_token_jwe, /^eyJ/u);
  assert.equal(JSON.stringify(storedSession).includes(identity.email), false, "provider email mapping is not part of the BFF session RPC result");
  for (const value of [identity.providerSession.access_token, identity.providerSession.refresh_token]) {
    assert.equal(JSON.stringify(storedSession).includes(value), false, "provider tokens are encrypted at rest");
  }
  const checked = await api("/api/auth/session", { headers: { Cookie: issued.cookie } });
  assert.deepEqual(await json(checked), {
    authenticated: true,
    user: { role: "student", mustChangePassword: true },
    csrfToken: session.csrfToken,
  });
  assert.equal(issued.value.length, 43);
});

test("unknown and incorrect passwords share a generic, minimum-duration response", async (context) => {
  const identity = await createIdentity(context, "login-failure");
  const ip = "192.0.2.11";
  const startedAt = performance.now();
  const incorrect = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": ip },
    body: { username: identity.username, password: "not-the-password" },
  });
  const incorrectDuration = performance.now() - startedAt;
  const unknownStart = performance.now();
  const unknown = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": ip },
    body: { username: `missing.${crypto.randomUUID().slice(0, 8)}`, password: "not-the-password" },
  });
  const unknownDuration = performance.now() - unknownStart;

  assert.equal(incorrect.status, 401);
  assert.equal(unknown.status, 401);
  const incorrectPayload = await json(incorrect);
  const unknownPayload = await json(unknown);
  assert.deepEqual(unknownPayload, incorrectPayload);
  assert.deepEqual(incorrectPayload, { error: "invalid_credentials" });
  assert.ok(incorrectDuration >= 450, `incorrect-password response observes the timing floor (${Math.round(incorrectDuration)}ms)`);
  assert.ok(unknownDuration >= 450, `unknown-username response observes the timing floor (${Math.round(unknownDuration)}ms)`);
  assert.equal(incorrect.headers.get("set-cookie"), null);
  assert.equal(unknown.headers.get("set-cookie"), null);
  assert.equal(JSON.stringify(incorrectPayload).includes(identity.email), false);
});

test("suspended account and unknown username share the generic failure response", async (context) => {
  const identity = await createIdentity(context, "login-suspended");
  setFictionalAccountStatus(identity.accountId, "suspended");
  const ip = "192.0.2.13";
  const suspended = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": ip },
    body: { username: identity.username, password: identity.password },
  });
  const unknown = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": ip },
    body: { username: `unknown.${crypto.randomUUID().slice(0, 8)}`, password: identity.password },
  });
  assert.equal(suspended.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await json(suspended), { error: "invalid_credentials" });
  assert.deepEqual(await json(unknown), { error: "invalid_credentials" });
});

test("login rejects missing Origin and malformed bodies before provider authentication", async () => {
  const noOrigin = await api("/api/auth/login", {
    method: "POST",
    body: { username: "fictional.user", password: "fictional-password" },
  });
  assert.equal(noOrigin.status, 403);
  assert.deepEqual(await json(noOrigin), { error: "request_rejected" });

  const invalid = await api("/api/auth/login", {
    method: "POST",
    origin,
    body: { username: "bad username", password: "fictional-password" },
    headers: { "CF-Connecting-IP": "192.0.2.12" },
  });
  assert.equal(invalid.status, 401);
  assert.deepEqual(await json(invalid), { error: "invalid_credentials" });
});
