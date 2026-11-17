import { configuration } from "./env.js";
import { hmacSha256Bytea } from "./secure-crypto.js";
import { clientIpForRateLimit } from "./validation.js";
import { serviceClient } from "./provider.js";

export async function consumeLoginAttempt(request, env, normalizedUsername) {
  const { rateLimitHmacKey } = configuration(env);
  const usernameKey = await hmacSha256Bytea(`username:v1:${normalizedUsername || "invalid"}`, rateLimitHmacKey);
  const clientIpKey = await hmacSha256Bytea(`ip:v1:${clientIpForRateLimit(request)}`, rateLimitHmacKey);
  const { data, error } = await serviceClient(env).rpc("consume_login_rate_limit", {
    p_username_key: usernameKey,
    p_client_ip_key: clientIpKey,
  });
  if (error) throw new Error("Login rate limit is unavailable.");
  return data === true;
}
