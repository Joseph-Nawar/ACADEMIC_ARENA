import { sameOriginRequest, validCsrfRequest } from "../../lib/csrf.js";
import { clearSessionCookie, jsonResponse } from "../../lib/response.js";
import { resolveSession } from "../../lib/session.js";
import { anonymousAuthClient, revokeProviderRefreshToken, serviceClient, userSessionClient } from "../../lib/provider.js";
import { consumeRefundableLoginAttempt, releaseLoginAttempt } from "../../lib/rate-limit.js";
import { authDiagnostics } from "../../lib/auth-diagnostics.js";
import { issueBffSession } from "../../lib/bff-login.js";
import { isStaffRoleSet } from "../../lib/staff-mfa.js";
import { hasExactKeys, readJsonBody, validNewPassword, validLoginPassword } from "../../lib/validation.js";

function loginIdentityRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

// After a confirmed change, a student is signed straight back in with the new
// password through the same checks as /api/auth/login, so they never have to
// retype it immediately (where every failed post-change sign-in in the
// 2026-11-20 incident happened). Staff keep the explicit re-sign-in, which
// also re-runs their MFA step. If the new session cannot be issued, the change
// still stands and the student signs in normally.
async function signInWithNewPassword(env, accountId, username, newPassword) {
  try {
    const provider = serviceClient(env);
    const [resolution, featureState] = await Promise.all([
      provider.rpc("resolve_login_identity", { p_username: username }),
      provider.rpc("public_feature_state"),
    ]);
    const identity = loginIdentityRow(resolution.data);
    const features = Array.isArray(featureState.data) ? featureState.data[0] : featureState.data;
    // Same gates as /api/auth/login, and the same account as the session.
    if (resolution.error || featureState.error || features?.student_sign_in !== true ||
        !identity || identity.account_id !== accountId || identity.account_status !== "active" ||
        identity.credential_update_pending === true ||
        !Array.isArray(identity.role_names) || identity.role_names.length === 0 || isStaffRoleSet(identity.role_names)) {
      return null;
    }
    const authResult = await anonymousAuthClient(env).auth.signInWithPassword({
      email: identity.provider_email,
      password: newPassword,
    });
    const issued = await issueBffSession(env, identity, authResult, {
      mustChangePassword: identity.force_password_change === true,
    });
    return issued.ok ? issued : null;
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOriginRequest(request)) return jsonResponse({ error: "request_rejected" }, 403);
  const diagnostics = authDiagnostics(context, "password_change");
  const { session, hadCookie } = await resolveSession(request, env);
  if (!session) {
    return jsonResponse({ error: "unauthorized" }, 401, hadCookie ? { "Set-Cookie": clearSessionCookie() } : {});
  }
  if (!await validCsrfRequest(request, session)) return jsonResponse({ error: "request_rejected" }, 403);
  const accountId = session.accountId;

  const body = await readJsonBody(request, 2048);
  if (!hasExactKeys(body, ["oldPassword", "newPassword"]) ||
      !validLoginPassword(body.oldPassword) || !validNewPassword(body.newPassword) ||
      body.oldPassword === body.newPassword) {
    diagnostics.record("invalid_request", "rejected", { accountId });
    return jsonResponse({ error: "password_change_failed" }, 400);
  }

  let identity;
  let allowed;
  let receipt;
  try {
    const { data, error } = await serviceClient(env).rpc("resolve_account_identity", {
      p_account_id: accountId,
    });
    if (error) {
      diagnostics.record("lookup_unavailable", "unavailable", { accountId });
      return jsonResponse({ error: "unavailable" }, 503);
    }
    identity = Array.isArray(data) ? data[0] || null : data || null;
    ({ allowed, receipt } = await consumeRefundableLoginAttempt(request, env, identity?.username_normalized || "invalid"));
  } catch {
    diagnostics.record("lookup_unavailable", "unavailable", { accountId });
    return jsonResponse({ error: "unavailable" }, 503);
  }
  if (!identity || identity.provider_user_id !== session.providerUserId || identity.account_status !== "active") {
    diagnostics.record("account_mismatch", "rejected", { accountId });
    return jsonResponse({ error: "password_change_failed" }, 400);
  }
  if (identity.credential_update_pending === true) {
    diagnostics.record("credential_update_pending", "rejected", { accountId });
    return jsonResponse({ error: "password_change_unavailable" }, 409);
  }
  if (!allowed) {
    diagnostics.record("rate_limited", "rejected", { accountId });
    return jsonResponse({ error: "password_change_failed" }, 400);
  }

  let reauthenticated;
  try {
    reauthenticated = await anonymousAuthClient(env).auth.signInWithPassword({
      email: identity.provider_email,
      password: body.oldPassword,
    });
  } catch {
    diagnostics.record("provider_unavailable", "unavailable", { accountId });
    return jsonResponse({ error: "unavailable" }, 503);
  }
  if (reauthenticated.error || reauthenticated.data?.user?.id !== identity.provider_user_id ||
      !reauthenticated.data?.session?.access_token || !reauthenticated.data?.session?.refresh_token) {
    if (reauthenticated.data?.session?.access_token && reauthenticated.data?.session?.refresh_token) {
      await revokeProviderRefreshToken(env, reauthenticated.data.session.access_token, reauthenticated.data.session.refresh_token);
    }
    diagnostics.record("current_password_rejected", "rejected", { accountId });
    return jsonResponse({ error: "password_change_failed" }, 400);
  }

  let providerClient;
  try {
    providerClient = await userSessionClient(env, session.providerAccessToken, session.providerRefreshToken);
  } catch {
    await revokeProviderRefreshToken(env, reauthenticated.data.session.access_token, reauthenticated.data.session.refresh_token);
    diagnostics.record("provider_unavailable", "unavailable", { accountId });
    return jsonResponse({ error: "unavailable" }, 503);
  }
  let passwordError;
  let updateUncertain = false;
  try {
    ({ error: passwordError } = await providerClient.auth.updateUser({
      password: body.newPassword,
      current_password: body.oldPassword,
    }));
  } catch {
    // No answer from Auth (timeout or network): the new password may or may
    // not be in effect. Say so instead of reporting a plain failure.
    updateUncertain = true;
  } finally {
    await revokeProviderRefreshToken(env, reauthenticated.data.session.access_token, reauthenticated.data.session.refresh_token);
  }
  if (!updateUncertain && passwordError) {
    const status = passwordError.status;
    updateUncertain = status === undefined || status === 0 || status === 408 || status >= 500;
  }
  if (updateUncertain) {
    diagnostics.record("provider_update_uncertain", "unavailable", { accountId });
    return jsonResponse({ error: "password_change_uncertain" }, 503);
  }
  if (passwordError) {
    diagnostics.record("provider_update_rejected", "rejected", { accountId });
    return jsonResponse({ error: "password_change_failed" }, 400);
  }

  // Auth has accepted the new password: from here on, the change has happened
  // and the response must say so, even if bookkeeping below fails. Students
  // get the limiter attempt back; staff keep it (shared with their TOTP checks).
  if (!isStaffRoleSet(session.roleNames)) await releaseLoginAttempt(env, receipt);
  let completed = false;
  try {
    const { data, error } = await serviceClient(env).rpc("complete_password_change", {
      p_account_id: accountId,
      p_expected_credential_epoch: identity.credential_epoch,
    });
    completed = !error && data === true;
  } catch {
    completed = false;
  }
  await revokeProviderRefreshToken(env, session.providerAccessToken, session.providerRefreshToken);
  if (!completed) {
    // The password is changed but the account still asks for a new one (or a
    // staff recovery took over). Sessions were not revoked by the database, so
    // revoke them here; the student signs in with the new password.
    let revoked = false;
    try {
      const { error } = await serviceClient(env).rpc("revoke_account_sessions", { p_account_id: accountId, p_reason: "password_change" });
      revoked = !error;
    } catch {
      revoked = false;
    }
    // "unavailable" marks that other sessions may still be live: an operator
    // should revoke them (the provider token and this cookie are gone).
    diagnostics.record("completion_failed", revoked ? "success" : "unavailable", { accountId });
    return jsonResponse({ changed: true, authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  const next = await signInWithNewPassword(env, accountId, identity.username_normalized, body.newPassword);
  if (next) {
    diagnostics.record("changed_signed_in", "success", { accountId });
    return jsonResponse({ changed: true, ...next.payload }, 200, { "Set-Cookie": next.cookie });
  }
  diagnostics.record("changed", "success", { accountId });
  return jsonResponse({ changed: true, authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
}
