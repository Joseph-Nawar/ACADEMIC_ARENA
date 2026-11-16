import { sameOriginRequest, validCsrfRequest } from "../../lib/csrf.js";
import { clearSessionCookie, jsonResponse } from "../../lib/response.js";
import { resolveSession } from "../../lib/session.js";
import { anonymousAuthClient, revokeProviderRefreshToken, serviceClient, userSessionClient } from "../../lib/provider.js";
import { consumeLoginAttempt } from "../../lib/rate-limit.js";
import { hasExactKeys, readJsonBody, validNewPassword, validLoginPassword } from "../../lib/validation.js";

export async function onRequestPost({ request, env }) {
  if (!sameOriginRequest(request)) return jsonResponse({ error: "request_rejected" }, 403);
  const { session, hadCookie } = await resolveSession(request, env);
  if (!session) {
    return jsonResponse({ error: "unauthorized" }, 401, hadCookie ? { "Set-Cookie": clearSessionCookie() } : {});
  }
  if (!await validCsrfRequest(request, session)) return jsonResponse({ error: "request_rejected" }, 403);

  const body = await readJsonBody(request, 2048);
  if (!hasExactKeys(body, ["oldPassword", "newPassword"]) ||
      !validLoginPassword(body.oldPassword) || !validNewPassword(body.newPassword) ||
      body.oldPassword === body.newPassword) {
    return jsonResponse({ error: "password_change_failed" }, 400);
  }

  let identity;
  let allowed;
  try {
    const { data, error } = await serviceClient(env).rpc("resolve_account_identity", {
      p_account_id: session.accountId,
    });
    if (error) return jsonResponse({ error: "unavailable" }, 503);
    identity = Array.isArray(data) ? data[0] || null : data || null;
    allowed = await consumeLoginAttempt(request, env, identity?.username_normalized || "invalid");
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
  if (!identity || identity.provider_user_id !== session.providerUserId || identity.account_status !== "active") {
    return jsonResponse({ error: "password_change_failed" }, 400);
  }
  if (!allowed) return jsonResponse({ error: "password_change_failed" }, 400);

  let reauthenticated;
  try {
    reauthenticated = await anonymousAuthClient(env).auth.signInWithPassword({
      email: identity.provider_email,
      password: body.oldPassword,
    });
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
  if (reauthenticated.error || reauthenticated.data?.user?.id !== identity.provider_user_id ||
      !reauthenticated.data?.session?.access_token || !reauthenticated.data?.session?.refresh_token) {
    if (reauthenticated.data?.session?.access_token && reauthenticated.data?.session?.refresh_token) {
      await revokeProviderRefreshToken(env, reauthenticated.data.session.access_token, reauthenticated.data.session.refresh_token);
    }
    return jsonResponse({ error: "password_change_failed" }, 400);
  }

  let providerClient;
  try {
    providerClient = await userSessionClient(env, session.providerAccessToken, session.providerRefreshToken);
  } catch {
    await revokeProviderRefreshToken(env, reauthenticated.data.session.access_token, reauthenticated.data.session.refresh_token);
    return jsonResponse({ error: "unavailable" }, 503);
  }
  let passwordError;
  try {
    ({ error: passwordError } = await providerClient.auth.updateUser({
      password: body.newPassword,
      current_password: body.oldPassword,
    }));
  } finally {
    await revokeProviderRefreshToken(env, reauthenticated.data.session.access_token, reauthenticated.data.session.refresh_token);
  }
  if (passwordError) return jsonResponse({ error: "password_change_failed" }, 400);

  const { data, error } = await serviceClient(env).rpc("complete_password_change", {
    p_account_id: session.accountId,
  });
  if (error || data !== true) return jsonResponse({ error: "unavailable" }, 503);

  await revokeProviderRefreshToken(env, session.providerAccessToken, session.providerRefreshToken);
  return jsonResponse({ changed: true, authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
}
