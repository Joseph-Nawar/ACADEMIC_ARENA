import assert from "node:assert/strict";
import * as OTPAuth from "otpauth";
import { api, createIdentity, json, local, setFictionalAccountRole } from "./bff-fixtures.mjs";

export const origin = new URL(local.pagesUrl).origin;
let ipCounter = 0;
export function nextIp() {
  ipCounter += 1;
  return `203.0.113.${(process.pid % 50) + ipCounter}`;
}

export function cookieFrom(response) {
  const value = (response.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(value, /^__Host-aa_session=[A-Za-z0-9_-]{43}$/u);
  return value;
}

export function headersFor(session) {
  return { Cookie: session.cookie, "X-CSRF-Token": session.csrfToken };
}

async function login(identity) {
  const response = await api("/api/auth/login", {
    method: "POST", origin,
    headers: { "CF-Connecting-IP": nextIp() },
    body: { username: identity.username, password: identity.password },
  });
  assert.equal(response.status, 200, "fictional login succeeds");
  const payload = await json(response);
  return { cookie: cookieFrom(response), csrfToken: payload.csrfToken, payload, identity };
}

export async function studentSession(context, label) {
  const identity = await createIdentity(context, label);
  setFictionalAccountRole(identity.accountId, "student");
  return login(identity);
}

// Staff with an enrolled TOTP factor and an AAL2 session.
export async function staffSession(context, label, role, { mfa = true } = {}) {
  const identity = await createIdentity(context, label);
  setFictionalAccountRole(identity.accountId, role);
  const session = await login(identity);
  if (!mfa) return session;
  const enrollment = await api("/api/auth/mfa/enroll", { method: "POST", origin, headers: headersFor(session), body: {} });
  assert.equal(enrollment.status, 200);
  const { secret } = await json(enrollment);
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
  const verify = await api("/api/auth/mfa/verify", { method: "POST", origin, headers: headersFor(session), body: { code } });
  assert.equal(verify.status, 200);
  return session;
}

export function call(session, path, { method = "GET", body, headers = {} } = {}) {
  return api(path, {
    method,
    origin: method === "GET" ? undefined : origin,
    headers: { ...(session ? headersFor(session) : {}), ...headers },
    body,
  });
}
