import assert from "node:assert/strict";
import test from "node:test";
import { api, createIdentity, json, local } from "./bff-fixtures.mjs";

const origin = new URL(local.pagesUrl).origin;

function cookieFrom(response) {
  const value = (response.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(value, /^__Host-aa_session=[A-Za-z0-9_-]{43}$/u);
  return value;
}

async function login(identity, password, ip) {
  const response = await api("/api/auth/login", {
    method: "POST", origin,
    headers: { "CF-Connecting-IP": ip },
    body: { username: identity.username, password },
  });
  return { response, cookie: cookieFrom(response), payload: await json(response) };
}

async function finishInitialPassword(identity, ipSuffix) {
  const first = await login(identity, identity.password, `192.0.2.${ipSuffix}`);
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.user.mustChangePassword, true);
  const password = `NewPassword-${crypto.randomUUID()}-A!`;
  const changed = await api("/api/auth/change-password", {
    method: "POST", origin,
    headers: { Cookie: first.cookie, "X-CSRF-Token": first.payload.csrfToken },
    body: { oldPassword: identity.password, newPassword: password },
  });
  assert.equal(changed.status, 200);
  assert.deepEqual(await json(changed), { changed: true, authenticated: false });
  const next = await login(identity, password, `192.0.2.${Number(ipSuffix) + 1}`);
  assert.equal(next.response.status, 200);
  assert.equal(next.payload.user.mustChangePassword, false);
  return { ...next, password };
}

test("same-origin avatar BFF stores only the caller's character fields and honors RLS ownership", async (context) => {
  const firstIdentity = await createIdentity(context, "avatar-owner-a");
  const first = await finishInitialPassword(firstIdentity, 60);

  const response = await api("/api/me/avatar", {
    method: "PUT", origin,
    headers: { Cookie: first.cookie, "X-CSRF-Token": first.payload.csrfToken },
    body: { avatar: { base: "mariam", style: "cartoon3d", tone: "coral", badge: "⚡" } },
  });
  const saved = await json(response);
  assert.equal(response.status, 200, JSON.stringify(saved));
  assert.deepEqual(saved, {
    saved: true,
    avatar: { base: "mariam", style: "cartoon3d", tone: "coral", badge: "⚡" },
    showOnLeaderboard: false,
  }, "public leaderboard display stays off unless the student opts in");

  const own = await api("/api/me/avatar", { headers: { Cookie: first.cookie } });
  assert.equal(own.status, 200);
  assert.deepEqual(await json(own), {
    avatar: { base: "mariam", style: "cartoon3d", tone: "coral", badge: "⚡" },
    showOnLeaderboard: false,
  });

  const secondIdentity = await createIdentity(context, "avatar-owner-b");
  const second = await finishInitialPassword(secondIdentity, 62);
  const other = await api(`/api/me/avatar?accountId=${encodeURIComponent(firstIdentity.accountId)}`, {
    headers: { Cookie: second.cookie },
  });
  assert.equal(other.status, 200);
  assert.deepEqual(await json(other), { avatar: null, showOnLeaderboard: false }, "a caller cannot select a different account's avatar");

  const concurrentAvatars = [
    { base: "omar", style: "ink", tone: "blue", badge: "★" },
    { base: "nour2", style: "cartoon3d", tone: "lilac", badge: "✦" },
  ];
  const concurrentUpdates = await Promise.all(concurrentAvatars.map((avatar) => api("/api/me/avatar", {
    method: "PUT", origin,
    headers: { Cookie: second.cookie, "X-CSRF-Token": second.payload.csrfToken },
    body: { avatar },
  })));
  const concurrentResults = await Promise.all(concurrentUpdates.map(async (result) => ({ status: result.status, body: await json(result) })));
  assert.ok(concurrentResults.every((result) => result.status === 200), `concurrent first writes either insert or update only this account's row: ${JSON.stringify(concurrentResults)}`);
  const finalAvatar = (await json(await api("/api/me/avatar", { headers: { Cookie: second.cookie } }))).avatar;
  assert.ok(concurrentAvatars.some((avatar) => JSON.stringify(avatar) === JSON.stringify(finalAvatar)),
    "the concurrent insert/update leaves exactly one valid avatar owned by this account");

  const forgedOwner = await api("/api/me/avatar", {
    method: "PUT", origin,
    headers: { Cookie: second.cookie, "X-CSRF-Token": second.payload.csrfToken },
    body: {
      avatar: { base: "omar", style: "ink", tone: "blue", badge: "★" },
      account_id: firstIdentity.accountId,
    },
  });
  assert.equal(forgedOwner.status, 400);
  assert.deepEqual(await json(forgedOwner), { error: "invalid_avatar" });

  const noOrigin = await api("/api/me/avatar", {
    method: "PUT",
    headers: { Cookie: second.cookie, "X-CSRF-Token": second.payload.csrfToken },
    body: { avatar: { base: "omar", style: "ink", tone: "blue", badge: "★" } },
  });
  assert.equal(noOrigin.status, 403);

  const anonymous = await api("/api/me/avatar");
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await json(anonymous), { error: "unauthorized" });
});
