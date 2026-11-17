import assert from "node:assert/strict";
import test from "node:test";
import { hmacSha256Bytea } from "../../functions/lib/secure-crypto.js";
import { api, createIdentity, json, local, serviceRpc } from "./bff-fixtures.mjs";

const key = process.env.AA_RATE_LIMIT_HMAC_KEY;
assert.ok(key, "rate-limit HMAC key is passed only to local integration tests");

test("persistent username rate limit is atomic under concurrent requests", async () => {
  const id = crypto.randomUUID();
  const usernameKey = await hmacSha256Bytea(`username:v1:${id}`, key);
  const attempts = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const ipKey = await hmacSha256Bytea(`ip:v1:192.0.2.${index + 1}`, key);
    const response = await serviceRpc("consume_login_rate_limit", {
      p_username_key: usernameKey,
      p_client_ip_key: ipKey,
    });
    assert.ok(response.ok, "local service can consume a rate-limit attempt");
    return json(response);
  }));
  assert.equal(attempts.filter(Boolean).length, 8);
  assert.equal(attempts.filter((allowed) => !allowed).length, 12);
});

test("persistent client-IP rate limit is atomic and distinct usernames cannot bypass it", async () => {
  const sharedIpKey = await hmacSha256Bytea(`ip:v1:${crypto.randomUUID()}`, key);
  const attempts = await Promise.all(Array.from({ length: 45 }, async () => {
    const usernameKey = await hmacSha256Bytea(`username:v1:${crypto.randomUUID()}`, key);
    const response = await serviceRpc("consume_login_rate_limit", {
      p_username_key: usernameKey,
      p_client_ip_key: sharedIpKey,
    });
    assert.ok(response.ok, "local service can consume a rate-limit attempt");
    return json(response);
  }));
  assert.equal(attempts.filter(Boolean).length, 40);
  assert.equal(attempts.filter((allowed) => !allowed).length, 5);
});

test("browser roles cannot query or clear persistent rate-limit records", async () => {
  const response = await fetch(new URL("/rest/v1/login_rate_limit_buckets?select=*", local.supabaseUrl), {
    headers: { apikey: local.anonKey, Authorization: `Bearer ${local.anonKey}` },
  });
  assert.ok(!response.ok, "anonymous PostgREST cannot expose hashed login identifiers or attempt counts");
});

test("throttled BFF login remains indistinguishable from an incorrect password", async (context) => {
  const identity = await createIdentity(context, "login-throttled");
  const origin = new URL(local.pagesUrl).origin;
  const responses = await Promise.all(Array.from({ length: 12 }, () => api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": "192.0.2.40" },
    body: { username: identity.username, password: "incorrect-fictional-password" },
  })));
  const payloads = await Promise.all(responses.map(json));
  assert.ok(responses.every((response) => response.status === 401), "rate-limited and provider-rejected logins share status");
  assert.ok(payloads.every((payload) => JSON.stringify(payload) === JSON.stringify({ error: "invalid_credentials" })),
    "rate-limit details and account existence are not exposed to the browser");
  assert.ok(responses.every((response) => response.headers.get("set-cookie") === null), "failed login never issues a session cookie");
});
