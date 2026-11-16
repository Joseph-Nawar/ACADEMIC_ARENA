import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { CompactEncrypt } from "jose";

export const local = Object.freeze({
  supabaseUrl: process.env.AA_SUPABASE_URL,
  anonKey: process.env.AA_SUPABASE_ANON_KEY,
  serviceRoleKey: process.env.AA_SUPABASE_SERVICE_ROLE_KEY,
  pagesUrl: process.env.AA_PAGES_URL,
  jweKey: process.env.AA_SESSION_JWE_KEY,
});

for (const [key, value] of Object.entries(local)) {
  assert.ok(value, `${key} is supplied only by npm run test:m2:local`);
}

const encoder = new TextEncoder();

export function randomOpaqueToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

export async function hashToken(value) {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

function base64Url(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function encryptJwe(value, type) {
  const key = decodeBase64Url(local.jweKey);
  assert.equal(key.byteLength, 32, "local JWE key is an ephemeral 256-bit key");
  return new CompactEncrypt(encoder.encode(value))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: type })
    .encrypt(key);
}

export async function json(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function api(path, { method = "GET", token = local.anonKey, body, origin, headers = {} } = {}) {
  const requestHeaders = { Accept: "application/json", ...headers };
  if (origin) requestHeaders.Origin = origin;
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  return fetch(new URL(path, local.pagesUrl), {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
}

export function serviceRpc(name, args) {
  return fetch(new URL(`/rest/v1/rpc/${name}`, local.supabaseUrl), {
    method: "POST",
    headers: {
      apikey: local.serviceRoleKey,
      Authorization: `Bearer ${local.serviceRoleKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(args),
  });
}

export async function injectProviderFailure(providerUserId, operation) {
  assert.match(providerUserId, /^[0-9a-f-]{36}$/iu);
  assert.ok(["user-password-update", "mfa-factor-list"].includes(operation));
  const response = await fetch(new URL("/__local_test__/fail-next-provider-request", local.supabaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerUserId, operation }),
  });
  assert.equal(response.status, 204, "loopback test proxy arms a one-time failure for a fictional provider identity");
}

export async function pauseNextProviderRequest(providerUserId, operation) {
  assert.match(providerUserId, /^[0-9a-f-]{36}$/iu);
  assert.ok(["user-password-update", "mfa-factor-list"].includes(operation));
  const response = await fetch(new URL("/__local_test__/pause-next-provider-request", local.supabaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerUserId, operation }),
  });
  assert.equal(response.status, 204, "loopback test proxy pauses one selected fictional provider request");
}

export async function providerRequestState(providerUserId, operation) {
  const url = new URL("/__local_test__/provider-request-state", local.supabaseUrl);
  url.searchParams.set("providerUserId", providerUserId);
  url.searchParams.set("operation", operation);
  const response = await fetch(url);
  assert.equal(response.status, 200, "loopback test proxy reports selected fictional provider request state");
  return response.json();
}

export async function releaseProviderRequest(providerUserId, operation) {
  const response = await fetch(new URL("/__local_test__/release-provider-request", local.supabaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerUserId, operation }),
  });
  assert.equal(response.status, 204, "loopback test proxy releases the selected delayed fictional provider request");
}

export function setFictionalAccountStatus(accountId, status) {
  assert.match(accountId, /^[0-9a-f-]{36}$/iu);
  assert.ok(["active", "suspended"].includes(status));
  try {
    execFileSync("npx", [
      "--no-install", "supabase", "db", "query", "--local",
      `update app_private.accounts set status = '${status}' where id = '${accountId}'`,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("Local fictional account state fixture could not be applied.");
  }
}

export function setFictionalAccountRole(accountId, role) {
  assert.match(accountId, /^[0-9a-f-]{36}$/iu);
  assert.ok(["student", "moderator", "publisher", "admin"].includes(role));
  try {
    for (const sql of [
      `update app_private.accounts set force_password_change = false where id = '${accountId}'`,
      `delete from app_private.account_role_grants where account_id = '${accountId}'`,
      `insert into app_private.account_role_grants (account_id, role_name) values ('${accountId}', '${role}')`,
    ]) {
      execFileSync("npx", ["--no-install", "supabase", "db", "query", "--local", sql], {
        cwd: process.cwd(),
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
        stdio: ["ignore", "pipe", "ignore"],
      });
    }
  } catch {
    throw new Error("Local fictional account role fixture could not be applied.");
  }
}

export async function cleanupProvisionedIdentity(context, username) {
  const lookup = await serviceRpc("resolve_login_identity", { p_username: username });
  assert.ok(lookup.ok, "test runner can resolve only its fictional provisioned account through the private RPC");
  const rows = await json(lookup);
  const identity = Array.isArray(rows) ? rows[0] : rows;
  assert.ok(identity?.provider_user_id, "the fictional provisioned account has a provider user for cleanup");
  context.after(async () => {
    const deleted = await fetch(new URL(`/auth/v1/admin/users/${encodeURIComponent(identity.provider_user_id)}`, local.supabaseUrl), {
      method: "DELETE",
      headers: {
        apikey: local.serviceRoleKey,
        Authorization: `Bearer ${local.serviceRoleKey}`,
      },
    });
    assert.ok(deleted.ok, `local fictional provisioned identity cleanup failed with HTTP ${deleted.status}`);
  });
  return identity;
}

export async function createIdentity(context, label = "bff-fixture") {
  const email = `${label}-${crypto.randomUUID()}@academic-arena.test`;
  const password = `${crypto.randomUUID()}Aa!`;
  const adminResponse = await fetch(new URL("/auth/v1/admin/users", local.supabaseUrl), {
    method: "POST",
    headers: {
      apikey: local.serviceRoleKey,
      Authorization: `Bearer ${local.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  assert.ok(adminResponse.ok, `local fictional identity creation failed with HTTP ${adminResponse.status}`);
  const user = await json(adminResponse);
  context.after(async () => {
    const deleted = await fetch(new URL(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, local.supabaseUrl), {
      method: "DELETE",
      headers: {
        apikey: local.serviceRoleKey,
        Authorization: `Bearer ${local.serviceRoleKey}`,
      },
    });
    assert.ok(deleted.ok, `local fictional identity cleanup failed with HTTP ${deleted.status}`);
  });

  const username = `${label}.${crypto.randomUUID().slice(0, 8)}`;
  const accountId = crypto.randomUUID();
  try {
    for (const sql of [
      `insert into app_private.accounts (id, provider_user_id, status, force_password_change) values ('${accountId}', '${user.id}', 'active', true)`,
      `insert into app_private.identity_mappings (account_id, username_normalized, provider_email) values ('${accountId}', '${username}', '${email}')`,
      `insert into app_private.account_role_grants (account_id, role_name) values ('${accountId}', 'student')`,
      `insert into app_private.audit_events (target_account_id, action_key, reason_code) values ('${accountId}', 'account.provisioned', 'test_fixture')`,
    ]) {
      execFileSync("npx", ["--no-install", "supabase", "db", "query", "--local", sql], {
        cwd: process.cwd(),
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
        stdio: ["ignore", "pipe", "ignore"],
      });
    }
  } catch {
    throw new Error("Local fictional account fixture could not be provisioned.");
  }
  const passwordLogin = await fetch(new URL("/auth/v1/token?grant_type=password", local.supabaseUrl), {
    method: "POST",
    headers: { apikey: local.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(passwordLogin.ok, `local fictional password login failed with HTTP ${passwordLogin.status}`);
  const providerSession = await json(passwordLogin);
  assert.equal(providerSession.user.id, user.id);
  return { user, email, password, username, accountId, providerSession };
}

export async function createServerSession(context, identity, { expiresInMs = 600_000, retainProviderRefreshToken = false } = {}) {
  const sessionToken = randomOpaqueToken();
  const csrfToken = randomOpaqueToken();
  const payload = identity.providerSession;
  const jwtPart = payload.access_token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
  const jwtPayload = JSON.parse(atob(jwtPart + "=".repeat((4 - jwtPart.length % 4) % 4)));
  const providerExpiresAt = new Date(payload.expires_at * 1000).toISOString();
  const sessionExpiresAt = new Date(Math.min(Date.now() + expiresInMs, payload.expires_at * 1000)).toISOString();
  const encryptedAccessToken = await encryptJwe(payload.access_token, "AA-ACCESS");
  const encryptedCsrfToken = await encryptJwe(csrfToken, "AA-CSRF");
  const encryptedRefreshToken = retainProviderRefreshToken
    ? await encryptJwe(payload.refresh_token, "AA-REFRESH")
    : null;
  const created = await serviceRpc("create_bff_session", {
    p_session_token_hash: toPostgresBytea(await hashToken(sessionToken)),
    p_csrf_token_hash: toPostgresBytea(await hashToken(csrfToken)),
    p_csrf_token_jwe: encryptedCsrfToken,
    p_account_id: identity.accountId,
    p_provider_session_id: jwtPayload.session_id,
    p_provider_access_token_jwe: encryptedAccessToken,
    p_provider_refresh_token_jwe: encryptedRefreshToken,
    p_provider_access_expires_at: providerExpiresAt,
    p_expires_at: sessionExpiresAt,
  });
  assert.ok(created.ok, `local server-side BFF session creation failed with HTTP ${created.status}`);
  return { sessionToken, csrfToken, expiresAt: sessionExpiresAt };
}

function toPostgresBytea(value) {
  return `\\x${[...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export { toPostgresBytea };

export function sessionCookie(sessionToken) {
  return `__Host-aa_session=${sessionToken}`;
}
