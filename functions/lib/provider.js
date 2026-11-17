import { createClient } from "@supabase/supabase-js";
import { configuration } from "./env.js";

async function safeFetch(input, init = {}) {
  const timeoutSignal = AbortSignal.timeout(15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(input, { ...init, signal, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new TypeError("Upstream redirects are not accepted.");
  }
  return response;
}

// Password update (PUT /admin/users/{id}) is not fenced by Supabase Auth: a
// request whose outcome is unknown could still change the password later. A
// claim is released only when Auth itself (not a gateway) answered with one of
// its documented error codes for checks that run before the user record is
// written: admin authentication, rate limiting, user lookup, and request or
// password validation. Anything else (no response, timeout, any 5xx, a 4xx
// without an Auth error code, or another code) keeps the account fail-closed
// for operator reconciliation. Re-verify this list when the Auth version changes.
const PASSWORD_UPDATE_PRE_WRITE_ERROR_CODES = new Set([
  "bad_json",
  "bad_jwt",
  "no_authorization",
  "not_admin",
  "over_request_rate_limit",
  "user_not_found",
  "validation_failed",
  "weak_password",
]);

export function passwordUpdateRejectedBeforeWrite(error) {
  const status = error?.status;
  return Number.isInteger(status) && status >= 400 && status <= 499 && status !== 408 &&
    typeof error.code === "string" && PASSWORD_UPDATE_PRE_WRITE_ERROR_CODES.has(error.code);
}

function options(extra = {}) {
  const { auth: extraAuth = {}, global: extraGlobal = {}, ...rest } = extra;
  return {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
      ...extraAuth,
    },
    global: {
      fetch: safeFetch,
      ...extraGlobal,
    },
    ...rest,
  };
}

export function serviceClient(env) {
  const config = configuration(env, { requireServiceRole: true });
  return createClient(config.supabaseUrl, config.serviceRoleKey, options());
}

export function anonymousAuthClient(env) {
  const config = configuration(env);
  return createClient(config.supabaseUrl, config.anonKey, options());
}

export function userAuthClient(env, accessToken) {
  const config = configuration(env);
  return createClient(config.supabaseUrl, config.anonKey, options({
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  }));
}

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, value); }
  removeItem(key) { this.#values.delete(key); }
}

export async function userSessionClient(env, accessToken, refreshToken) {
  const config = configuration(env);
  const client = createClient(config.supabaseUrl, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
      storage: new MemoryStorage(),
    },
    global: { fetch: safeFetch },
  });
  const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) throw error;
  return client;
}

export async function verifyProviderUser(env, accessToken) {
  const { data, error } = await anonymousAuthClient(env).auth.getUser(accessToken);
  if (error) return { user: null, status: typeof error.status === "number" ? error.status : 0 };
  return { user: data.user, status: 200 };
}

export async function revokeProviderRefreshToken(env, accessToken, refreshToken) {
  if (typeof refreshToken !== "string" || refreshToken.length === 0 || refreshToken.length > 4096) {
    return false;
  }
  try {
    const client = await userSessionClient(env, accessToken, refreshToken);
    const { error } = await client.auth.signOut({ scope: "local" });
    return !error;
  } catch {
    // BFF revocation is authoritative if Auth is unavailable; provider access JWTs still expire.
    return false;
  }
}
