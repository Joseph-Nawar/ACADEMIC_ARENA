import { decodeJwt } from "jose";
import { revokeProviderRefreshToken, serviceClient } from "./provider.js";
import { isStaffRoleSet, listSessionMfaFactors } from "./staff-mfa.js";
import { encryptSessionSecret, randomOpaqueToken, sha256Bytea } from "./secure-crypto.js";
import { sessionCookie } from "./response.js";
import { safeRole } from "./session.js";

// Turns a Supabase Auth password-grant result into an opaque BFF session.
// Shared by sign-in and by a student's successful password change, so both
// apply exactly the same identity, token and session checks.
//
// Returns { ok: true, payload, cookie } or { ok: false, stage, outcome }
// where outcome is "rejected" (generic 401) or "unavailable" (503).
export async function issueBffSession(env, identity, authResult, { mustChangePassword }) {
  const providerSession = authResult?.data?.session;
  const providerUser = authResult?.data?.user;
  if (authResult?.error || !providerSession || !providerUser) {
    if (providerSession?.access_token && providerSession?.refresh_token) {
      await revokeProviderRefreshToken(env, providerSession.access_token, providerSession.refresh_token);
    }
    // Auth throttling (429) or outage (0/5xx) is not a wrong password: say
    // "temporarily unavailable", so a student with a correct first-time
    // password is never told to check it. Only Auth's own credential
    // rejection gets the generic invalid-credentials answer.
    const status = authResult?.error?.status;
    const unavailable = status === undefined || status === 0 || status === 429 || status >= 500;
    return unavailable
      ? { ok: false, stage: "provider_unavailable", outcome: "unavailable" }
      : { ok: false, stage: "provider_rejected", outcome: "rejected" };
  }
  if (providerUser.id !== identity.provider_user_id ||
      typeof providerUser.email !== "string" || providerUser.email.toLowerCase() !== identity.provider_email ||
      typeof providerSession.access_token !== "string" ||
      typeof providerSession.refresh_token !== "string" || providerSession.refresh_token.length === 0) {
    if (providerSession?.access_token && providerSession?.refresh_token) {
      await revokeProviderRefreshToken(env, providerSession.access_token, providerSession.refresh_token);
    }
    return { ok: false, stage: "provider_identity_mismatch", outcome: "rejected" };
  }

  let claims;
  try {
    claims = decodeJwt(providerSession.access_token);
  } catch {
    await revokeProviderRefreshToken(env, providerSession.access_token, providerSession.refresh_token);
    return { ok: false, stage: "provider_token_invalid", outcome: "rejected" };
  }
  const providerExpiresAt = Number(claims.exp) * 1000;
  if (claims.sub !== providerUser.id || !/^[0-9a-f-]{36}$/iu.test(String(claims.session_id || "")) ||
      !Number.isFinite(providerExpiresAt) || providerExpiresAt <= Date.now()) {
    await revokeProviderRefreshToken(env, providerSession.access_token, providerSession.refresh_token);
    return { ok: false, stage: "provider_token_invalid", outcome: "rejected" };
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
        return { ok: false, stage: "mfa_factor_error", outcome: "unavailable" };
      }
      return { ok: false, stage: "mfa_factor_error", outcome: "rejected" };
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
    return { ok: false, stage: "session_store_failed", outcome: "unavailable" };
  }

  const payload = {
    authenticated: true,
    user: {
      role: safeRole(identity.role_names),
      mustChangePassword: mustChangePassword === true,
    },
    csrfToken,
  };
  if (staffAccount) {
    payload.user.mfaRequired = claims.aal !== "aal2" || !hasVerifiedTotp;
    payload.user.mfaSetupRequired = !hasVerifiedTotp;
  }
  return { ok: true, payload, cookie: sessionCookie(sessionToken, (sessionExpiresAt - Date.now()) / 1000) };
}
