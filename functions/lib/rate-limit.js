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
// concurrent guesses cannot race past the limit.
export async function consumeLoginAttempt(request, env, normalizedUsername) {
  const { data, error } = await serviceClient(env).rpc("consume_login_rate_limit",
    await limiterKeys(request, env, normalizedUsername));
  if (error) throw new Error("Login rate limit is unavailable.");
  return data === true;
}

// Gives the attempt back after Auth accepted the password, so the limiter
// counts failures only: successful students on one campus network, and a
// student's own sign-in and password change, never use up the allowance.
// Best effort: a failure here only leaves the attempt counted.
export async function releaseLoginAttempt(request, env, normalizedUsername) {
  try {
    await serviceClient(env).rpc("release_login_attempt", await limiterKeys(request, env, normalizedUsername));
  } catch {
    // The attempt stays counted; never fail a successful sign-in for this.
  }
}
