import { createClient } from "@supabase/supabase-js";
import { configuration } from "./env.js";

async function safeFetch(input, init = {}) {
  const response = await fetch(input, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new TypeError("Upstream redirects are not accepted.");
  }
  return response;
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
