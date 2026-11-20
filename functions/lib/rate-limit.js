import { configuration } from "./env.js";
import { hmacSha256Bytea } from "./secure-crypto.js";
import { clientIpForRateLimit } from "./validation.js";
import { serviceClient } from "./provider.js";

async function limiterKeys(request, env, normalizedUsername) {
  const { rateLimitHmacKey } = configuration(env);
  const [usernameKey, clientIpKey] = await Promise.all([
    hmacSha256Bytea(`username:v1:${normalizedUsername || "invalid"}`, rateLimitHmacKey),
    hmacSha256Bytea(`ip:v1:${clientIpForRateLimit(request)}`, rateLimitHmacKey),
  ]);
  return { p_username_key: usernameKey, p_client_ip_key: clientIpKey };
}

// Consumes one attempt atomically before the password is checked, so
// concurrent guesses cannot race past the limit. Used where the attempt is
// never given back (staff MFA checks).
export async function consumeLoginAttempt(request, env, normalizedUsername) {
  const { data, error } = await serviceClient(env).rpc("consume_login_rate_limit",
    await limiterKeys(request, env, normalizedUsername));
  if (error) throw new Error("Login rate limit is unavailable.");
  return data === true;
}

// Like consumeLoginAttempt, but also returns a receipt naming the exact
// limiter windows this attempt was counted in, so a later success can give
// back this attempt and nothing else (never a failure counted in a newer
// window). Window timestamps are passed back verbatim (microsecond strings).
export async function consumeRefundableLoginAttempt(request, env, normalizedUsername) {
  const keys = await limiterKeys(request, env, normalizedUsername);
  const { data, error } = await serviceClient(env).rpc("consume_login_attempt", keys);
  if (error) throw new Error("Login rate limit is unavailable.");
  const row = Array.isArray(data) ? data[0] : data;
  const receipt = typeof row?.username_window === "string" && typeof row?.client_ip_window === "string"
    ? { ...keys, p_username_window: row.username_window, p_client_ip_window: row.client_ip_window }
    : null;
  return { allowed: row?.allowed === true, receipt };
}

// Gives the attempt back after Auth accepted the password, so the limiter
// counts failures only: successful students on one campus network, and a
// student's own sign-in and password change, never use up the allowance.
// Best effort: a failure here only leaves the attempt counted.
export async function releaseLoginAttempt(env, receipt) {
  if (!receipt) return;
  try {
    await serviceClient(env).rpc("release_login_attempt", receipt);
  } catch {
    // The attempt stays counted; never fail a successful sign-in for this.
  }
}
