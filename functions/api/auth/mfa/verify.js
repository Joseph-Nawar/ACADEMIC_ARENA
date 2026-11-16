import { decodeJwt } from "jose";
import { authorizeStaffMfaRequest } from "../../../lib/mfa-authorization.js";
import { encryptSessionSecret } from "../../../lib/secure-crypto.js";
import { serviceClient, verifyProviderUser } from "../../../lib/provider.js";
import { listSessionMfaFactors } from "../../../lib/staff-mfa.js";
import { jsonResponse } from "../../../lib/response.js";
import { findAccountIdentity } from "../../../lib/staff-accounts.js";
import { consumeLoginAttempt } from "../../../lib/rate-limit.js";
import { hasExactKeys, readJsonBody } from "../../../lib/validation.js";
import { safeRole } from "../../../lib/session.js";

function verificationFailure() {
  return jsonResponse({ error: "mfa_verification_failed" }, 400);
}

export async function onRequestPost({ request, env }) {
  const { response, session } = await authorizeStaffMfaRequest(request, env);
  if (response) return response;
  const body = await readJsonBody(request, 256);
  if (!hasExactKeys(body, ["code"]) || typeof body.code !== "string" || !/^\d{6}$/u.test(body.code)) {
    return verificationFailure();
  }

  let identity;
  let factors;
  try {
    identity = await findAccountIdentity(env, session.accountId);
    if (!identity || identity.account_status !== "active") return verificationFailure();
    if (!await consumeLoginAttempt(request, env, identity.username_normalized)) {
      return jsonResponse({ error: "mfa_verification_failed" }, 429);
    }
    factors = await listSessionMfaFactors(env, session.providerAccessToken, session.providerRefreshToken);
  } catch {
    return jsonResponse({ error: "mfa_unavailable" }, 503);
  }

  const pending = factors.pendingTotp[0];
  const factor = pending || factors.verifiedTotp[0];
  if (!factor) return verificationFailure();

  let result;
  try {
    result = await factors.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: body.code });
  } catch {
    return verificationFailure();
  }
  const providerSession = result?.data;
  const accessToken = providerSession?.access_token;
  const refreshToken = providerSession?.refresh_token;
  const providerUser = providerSession?.user;
  if (result?.error || !accessToken || !refreshToken || providerUser?.id !== session.providerUserId) {
    return verificationFailure();
  }

  let claims;
  try {
    claims = decodeJwt(accessToken);
  } catch {
    return verificationFailure();
  }
  const expiresAt = Number(claims.exp) * 1000;
  if (claims.sub !== session.providerUserId || claims.session_id !== session.providerSessionId ||
      claims.aal !== "aal2" || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return verificationFailure();
  }

  const checked = await verifyProviderUser(env, accessToken);
  if (checked.status >= 500 || checked.status === 0 || checked.status === 429) {
    return jsonResponse({ error: "mfa_unavailable" }, 503);
  }
  if (!checked.user || checked.user.id !== session.providerUserId) return verificationFailure();

  try {
    const encryptedAccessToken = await encryptSessionSecret(accessToken, env.SESSION_JWE_KEY, "AA-ACCESS");
    const encryptedRefreshToken = await encryptSessionSecret(refreshToken, env.SESSION_JWE_KEY, "AA-REFRESH");
    const { data, error } = await serviceClient(env).rpc("update_bff_session_provider_tokens", {
      p_session_token_hash: session.tokenHash,
      p_provider_session_id: claims.session_id,
      p_provider_access_token_jwe: encryptedAccessToken,
      p_provider_refresh_token_jwe: encryptedRefreshToken,
      p_provider_access_expires_at: new Date(expiresAt).toISOString(),
    });
    if (error || data !== true) return jsonResponse({ error: "mfa_session_update_failed" }, 503);
    const { data: auditRecorded, error: auditError } = await serviceClient(env).rpc("record_staff_mfa_event", {
      p_account_id: session.accountId,
      p_action_key: pending ? "staff.mfa_enrolled" : "staff.mfa_verified",
    });
    if (auditError || auditRecorded !== true) return jsonResponse({ error: "mfa_audit_failed" }, 503);
  } catch {
    return jsonResponse({ error: "mfa_session_update_failed" }, 503);
  }

  return jsonResponse({
    authenticated: true,
    user: {
      role: safeRole(session.roleNames),
      mustChangePassword: false,
      mfaRequired: false,
      mfaSetupRequired: false,
    },
  });
}
