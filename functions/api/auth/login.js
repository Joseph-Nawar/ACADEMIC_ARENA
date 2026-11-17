import { decodeJwt } from "jose";
import { anonymousAuthClient, revokeProviderRefreshToken, serviceClient } from "../../lib/provider.js";
import { isStaffRoleSet, listSessionMfaFactors } from "../../lib/staff-mfa.js";
import { sameOriginRequest } from "../../lib/csrf.js";
import { encryptSessionSecret, randomOpaqueToken, sha256Bytea } from "../../lib/secure-crypto.js";
import { jsonResponse, sessionCookie } from "../../lib/response.js";
import { safeRole } from "../../lib/session.js";
import { consumeLoginAttempt } from "../../lib/rate-limit.js";
import {
  delayAuthenticationFailure,
  hasExactKeys,
  normalizeUsername,
  readJsonBody,
  validLoginPassword,
} from "../../lib/validation.js";

function genericFailure(startedAt) {
  return delayAuthenticationFailure(startedAt).then(() =>
    jsonResponse({ error: "invalid_credentials" }, 401));
}

function loginIdentityRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function onRequestPost({ request, env }) {
  if (!sameOriginRequest(request)) return jsonResponse({ error: "request_rejected" }, 403);
  const startedAt = performance.now();
  const body = await readJsonBody(request, 4096);
  const validShape = hasExactKeys(body, ["username", "password"]);
  const username = validShape ? normalizeUsername(body.username) : null;
  const password = validShape && validLoginPassword(body.password) ? body.password : null;

  let allowed;
  try {
    allowed = await consumeLoginAttempt(request, env, username);
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
  if (!allowed || !username || !password) return genericFailure(startedAt);

  let identity;
  try {
    const provider = serviceClient(env);
    const [cleanup, resolution] = await Promise.all([
      provider.rpc("prune_expired_credential_sync_operations"),
      provider.rpc("resolve_login_identity", { p_username: username }),
    ]);
    if (cleanup.error || resolution.error) return jsonResponse({ error: "unavailable" }, 503);
    const { data } = resolution;
    identity = loginIdentityRow(data);
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
  if (!identity || identity.account_status !== "active" || identity.credential_update_pending === true ||
      !Array.isArray(identity.role_names) || identity.role_names.length === 0) {
    return genericFailure(startedAt);
  }

  let authResult;
  try {
    authResult = await anonymousAuthClient(env).auth.signInWithPassword({
      email: identity.provider_email,
      password,
    });
  } catch {
    return genericFailure(startedAt);
  }
  const providerSession = authResult?.data?.session;
  const providerUser = authResult?.data?.user;
  if (authResult?.error || !providerSession || !providerUser ||
      providerUser.id !== identity.provider_user_id ||
      typeof providerUser.email !== "string" || providerUser.email.toLowerCase() !== identity.provider_email ||
      typeof providerSession.access_token !== "string" ||
      typeof providerSession.refresh_token !== "string" || providerSession.refresh_token.length === 0) {
    if (providerSession?.access_token && providerSession?.refresh_token) {
      await revokeProviderRefreshToken(env, providerSession.access_token, providerSession.refresh_token);
    }
    return genericFailure(startedAt);
  }

  let claims;
  try {
    claims = decodeJwt(providerSession.access_token);
  } catch {
    await revokeProviderRefreshToken(env, providerSession.access_token, providerSession.refresh_token);
    return genericFailure(startedAt);
  }
  const providerExpiresAt = Number(claims.exp) * 1000;
  if (claims.sub !== providerUser.id || !/^[0-9a-f-]{36}$/iu.test(String(claims.session_id || "")) ||
      !Number.isFinite(providerExpiresAt) || providerExpiresAt <= Date.now()) {
    await revokeProviderRefreshToken(env, providerSession.access_token, providerSession.refresh_token);
    return genericFailure(startedAt);
  }

  const staffAccount = isStaffRoleSet(identity.role_names);
  let hasVerifiedTotp = false;
  if (staffAccount) {
    try {
      const factors = await listSessionMfaFactors(env, providerSession.access_token, providerSession.refresh_token);
      hasVerifiedTotp = factors.verifiedTotp.length > 0;
    } catch (error) {
      await revokeProviderRefreshToken(env, providerSession.access_token, providerSession.refresh_token);
      if ([0, 429].includes(error?.status) || error?.status >= 500) {
        return jsonResponse({ error: "unavailable" }, 503);
      }
      return genericFailure(startedAt);
    }
  }

  const sessionToken = randomOpaqueToken();
  const csrfToken = randomOpaqueToken();
  const sessionExpiresAt = Math.min(providerExpiresAt, Date.now() + 8 * 60 * 60 * 1000);
  try {
    const sessionTokenHash = await sha256Bytea(sessionToken);
    const csrfTokenHash = await sha256Bytea(csrfToken);
    const [csrfJwe, accessJwe, refreshJwe] = await Promise.all([
      encryptSessionSecret(csrfToken, env.SESSION_JWE_KEY, "AA-CSRF"),
      encryptSessionSecret(providerSession.access_token, env.SESSION_JWE_KEY, "AA-ACCESS"),
      encryptSessionSecret(providerSession.refresh_token, env.SESSION_JWE_KEY, "AA-REFRESH"),
    ]);
    const { error } = await serviceClient(env).rpc("create_bff_session", {
      p_session_token_hash: sessionTokenHash,
      p_csrf_token_hash: csrfTokenHash,
      p_csrf_token_jwe: csrfJwe,
      p_account_id: identity.account_id,
      p_provider_session_id: claims.session_id,
      p_provider_access_token_jwe: accessJwe,
      p_provider_refresh_token_jwe: refreshJwe,
      p_provider_access_expires_at: new Date(providerExpiresAt).toISOString(),
      p_expires_at: new Date(sessionExpiresAt).toISOString(),
    });
    if (error) throw new Error("BFF session could not be saved.");
  } catch {
    await revokeProviderRefreshToken(env, providerSession.access_token, providerSession.refresh_token);
    return jsonResponse({ error: "unavailable" }, 503);
  }

  const payload = {
    authenticated: true,
    user: {
      role: safeRole(identity.role_names),
      mustChangePassword: identity.force_password_change === true,
    },
    csrfToken,
  };
  if (staffAccount) {
    payload.user.mfaRequired = claims.aal !== "aal2" || !hasVerifiedTotp;
    payload.user.mfaSetupRequired = !hasVerifiedTotp;
  }
  return jsonResponse(payload, 200, { "Set-Cookie": sessionCookie(sessionToken, (sessionExpiresAt - Date.now()) / 1000) });
}
