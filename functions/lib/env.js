import { decodeBase64Url } from "./secure-crypto.js";

export function configuration(env, { requireServiceRole = false } = {}) {
  const environment = typeof env?.ENVIRONMENT === "string" ? env.ENVIRONMENT : "";
  const supabaseUrl = typeof env?.SUPABASE_URL === "string" ? env.SUPABASE_URL : "";
  const anonKey = typeof env?.SUPABASE_ANON_KEY === "string" ? env.SUPABASE_ANON_KEY : "";
  const serviceRoleKey = typeof env?.SUPABASE_SERVICE_ROLE_KEY === "string" ? env.SUPABASE_SERVICE_ROLE_KEY : "";
  const sessionJweKey = typeof env?.SESSION_JWE_KEY === "string" ? env.SESSION_JWE_KEY : "";
  const rateLimitHmacKey = typeof env?.RATE_LIMIT_HMAC_KEY === "string" ? env.RATE_LIMIT_HMAC_KEY : "";
  if (!supabaseUrl || !anonKey || (requireServiceRole && !serviceRoleKey) || !sessionJweKey || !rateLimitHmacKey) {
    throw new Error("Required server configuration is unavailable.");
  }
  if (!new Set(["test", "development", "production"]).has(environment)) {
    throw new Error("Server environment is not explicitly configured.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("Supabase endpoint is invalid.");
  }
  const loopback = new Set(["127.0.0.1", "[::1]", "localhost"]).has(parsedUrl.hostname);
  if (environment === "test") {
    if (parsedUrl.protocol !== "http:" || !loopback) throw new Error("Test Supabase endpoint must use loopback HTTP.");
  } else if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith(".supabase.co")) {
    throw new Error("Production Supabase endpoint must be an HTTPS Supabase project.");
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new Error("Supabase endpoint must not contain credentials or query parameters.");
  }
  if (decodeBase64Url(sessionJweKey).byteLength !== 32 || decodeBase64Url(rateLimitHmacKey).byteLength !== 32) {
    throw new Error("Server encryption and rate-limit keys must each be 256 bits.");
  }

  return Object.freeze({ environment, supabaseUrl: parsedUrl.origin, anonKey, serviceRoleKey, sessionJweKey, rateLimitHmacKey });
}
