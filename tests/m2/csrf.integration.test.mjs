import assert from "node:assert/strict";
import test from "node:test";
import { api, createIdentity, createServerSession, json, local, sessionCookie } from "./bff-fixtures.mjs";

test("logout requires an exact same-origin request and the session-bound CSRF value", async (context) => {
  const identity = await createIdentity(context, "csrf-student");
  const session = await createServerSession(context, identity, { retainProviderRefreshToken: true });
  const cookie = sessionCookie(session.sessionToken);
  const sameOrigin = new URL(local.pagesUrl).origin;

  for (const headers of [
    { Cookie: cookie },
    { Cookie: cookie, Origin: "https://attacker.invalid", "X-CSRF-Token": session.csrfToken },
    { Cookie: cookie, Origin: sameOrigin },
    { Cookie: cookie, Origin: sameOrigin, "X-CSRF-Token": "incorrect" },
  ]) {
    const rejected = await api("/api/auth/logout", { method: "POST", headers });
    assert.equal(rejected.status, 403, "missing or cross-origin CSRF context is rejected");
    assert.match(rejected.headers.get("cache-control") || "", /no-store/u);
    assert.equal((await rejected.text()).includes(identity.email), false);
  }

  const stillActive = await api("/api/auth/session", { headers: { Cookie: cookie } });
  assert.equal((await json(stillActive)).authenticated, true, "a rejected logout does not revoke the session");

  const logout = await api("/api/auth/logout", {
    method: "POST",
    origin: sameOrigin,
    headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken },
  });
  assert.ok([200, 204].includes(logout.status));
  const clearCookie = logout.headers.get("set-cookie") || "";
  assert.match(clearCookie, /__Host-aa_session=/u);
  assert.match(clearCookie, /Secure/iu);
  assert.match(clearCookie, /HttpOnly/iu);
  assert.match(clearCookie, /SameSite=Strict/iu);
  assert.match(clearCookie, /Path=\//u);
  assert.match(clearCookie, /Max-Age=0/iu);
  assert.doesNotMatch(clearCookie, /Domain=/iu);
  assert.match(logout.headers.get("cache-control") || "", /no-store/u);
  assert.equal((await logout.text()).includes(identity.email), false);

  const afterLogout = await api("/api/auth/session", { headers: { Cookie: cookie } });
  assert.deepEqual(await json(afterLogout), { authenticated: false });

  const refreshAttempt = await fetch(new URL("/auth/v1/token?grant_type=refresh_token", local.supabaseUrl), {
    method: "POST",
    headers: { apikey: local.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: identity.providerSession.refresh_token }),
  });
  assert.ok(refreshAttempt.status >= 400, "BFF logout revokes the server-held provider refresh credential");
});
