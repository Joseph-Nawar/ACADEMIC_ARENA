import assert from "node:assert/strict";
import test from "node:test";
import { api, createIdentity, json, local } from "./bff-fixtures.mjs";

const origin = new URL(local.pagesUrl).origin;

function cookieFrom(response) {
  const value = (response.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(value, /^__Host-aa_session=[A-Za-z0-9_-]{43}$/u);
  return value;
}

test("initial password change requires current credentials and revokes the prior BFF session", async (context) => {
  const identity = await createIdentity(context, "password-change");
  const login = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": "192.0.2.21" },
    body: { username: identity.username, password: identity.password },
  });
  assert.equal(login.status, 200);
  const cookie = cookieFrom(login);
  const session = await json(login);
  assert.equal(session.user.mustChangePassword, true);
  const nextPassword = `Changed-${crypto.randomUUID()}-A9!`;

  const invalidChange = await api("/api/auth/change-password", {
    method: "POST",
    origin,
    headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken },
    body: { oldPassword: "incorrect-old-password", newPassword: nextPassword },
  });
  assert.equal(invalidChange.status, 400);
  assert.deepEqual(await json(invalidChange), { error: "password_change_failed" });
  const stillActive = await api("/api/auth/session", { headers: { Cookie: cookie } });
  assert.equal((await json(stillActive)).authenticated, true, "failed password change leaves the current session available");

  const change = await api("/api/auth/change-password", {
    method: "POST",
    origin,
    headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken },
    body: { oldPassword: identity.password, newPassword: nextPassword },
  });
  assert.equal(change.status, 200);
  // V1.6: a student is signed straight back in with the new password, in a
  // brand-new session; the prior session is still revoked.
  const changed = await json(change);
  assert.equal(changed.changed, true);
  assert.equal(changed.authenticated, true);
  assert.deepEqual(changed.user, { role: "student", mustChangePassword: false });
  const renewedCookie = cookieFrom(change);
  assert.notEqual(renewedCookie, cookie, "the new session never reuses the prior cookie");
  for (const value of [identity.email, identity.password, nextPassword, identity.providerSession.access_token]) {
    assert.equal(JSON.stringify(changed).includes(value), false);
  }

  const priorSession = await api("/api/auth/session", { headers: { Cookie: cookie } });
  assert.deepEqual(await json(priorSession), { authenticated: false });
  const renewedSession = await json(await api("/api/auth/session", { headers: { Cookie: renewedCookie } }));
  assert.equal(renewedSession.authenticated, true);
  assert.equal(renewedSession.user.mustChangePassword, false);

  const oldCredential = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": "192.0.2.22" },
    body: { username: identity.username, password: identity.password },
  });
  assert.equal(oldCredential.status, 401);
  assert.deepEqual(await json(oldCredential), { error: "invalid_credentials" });

  const newCredential = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": "192.0.2.23" },
    body: { username: identity.username, password: nextPassword },
  });
  assert.equal(newCredential.status, 200);
  const nextSession = await json(newCredential);
  assert.deepEqual(nextSession.user, { role: "student", mustChangePassword: false });
  for (const value of [identity.email, identity.providerSession.access_token, identity.providerSession.refresh_token, local.serviceRoleKey]) {
    assert.equal(JSON.stringify(nextSession).includes(value), false);
  }
});

test("student session cannot provision or suspend accounts through staff routes", async (context) => {
  const identity = await createIdentity(context, "student-staff-denial");
  const login = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": "192.0.2.24" },
    body: { username: identity.username, password: identity.password },
  });
  assert.equal(login.status, 200);
  const cookie = cookieFrom(login);
  const session = await json(login);
  const attempts = await Promise.all([
    api("/api/staff/accounts", {
      method: "POST", origin,
      headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken },
      body: { username: "fictional.other", email: "other@academic-arena.test" },
    }),
    api("/api/staff/accounts/suspend", {
      method: "POST", origin,
      headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken },
      body: { username: identity.username },
    }),
  ]);
  for (const response of attempts) {
    assert.equal(response.status, 403);
    assert.deepEqual(await json(response), { error: "forbidden" });
  }
  assert.equal((await json(await api("/api/auth/session", { headers: { Cookie: cookie } }))).authenticated, true);
});
