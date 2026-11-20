import { anonymousAuthClient, serviceClient } from "../../lib/provider.js";
import { isStaffRoleSet } from "../../lib/staff-mfa.js";
import { sameOriginRequest } from "../../lib/csrf.js";
import { jsonResponse } from "../../lib/response.js";
import { consumeLoginAttempt, releaseLoginAttempt } from "../../lib/rate-limit.js";
import { authDiagnostics } from "../../lib/auth-diagnostics.js";
import { issueBffSession } from "../../lib/bff-login.js";
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

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOriginRequest(request)) return jsonResponse({ error: "request_rejected" }, 403);
  const startedAt = performance.now();
  const diagnostics = authDiagnostics(context, "login");
  const body = await readJsonBody(request, 4096);
  const validShape = hasExactKeys(body, ["username", "password"]);
  const username = validShape ? normalizeUsername(body.username) : null;
  const password = validShape && validLoginPassword(body.password) ? body.password : null;

  let allowed;
  try {
    allowed = await consumeLoginAttempt(request, env, username);
  } catch {
    diagnostics.record("lookup_unavailable", "unavailable");
    return jsonResponse({ error: "unavailable" }, 503);
  }
  if (!username || !password) {
    diagnostics.record("invalid_request", "rejected", { username });
    return genericFailure(startedAt);
  }
  if (!allowed) {
    diagnostics.record("rate_limited", "rejected", { username });
    return genericFailure(startedAt);
  }

  let identity;
  try {
    const provider = serviceClient(env);
    const [cleanup, resolution] = await Promise.all([
      provider.rpc("prune_expired_credential_sync_operations"),
      provider.rpc("resolve_login_identity", { p_username: username }),
    ]);
    if (cleanup.error || resolution.error) {
      diagnostics.record("lookup_unavailable", "unavailable");
      return jsonResponse({ error: "unavailable" }, 503);
    }
    identity = loginIdentityRow(resolution.data);
  } catch {
    diagnostics.record("lookup_unavailable", "unavailable");
    return jsonResponse({ error: "unavailable" }, 503);
  }
  const rejectionStage = !identity ? "unknown_username"
    : identity.account_status !== "active" ? "account_inactive"
      : identity.credential_update_pending === true ? "credential_update_pending"
        : !Array.isArray(identity.role_names) || identity.role_names.length === 0 ? "no_role"
          : null;
  if (rejectionStage) {
    diagnostics.record(rejectionStage, "rejected", { accountId: identity?.account_id || null });
    return genericFailure(startedAt);
  }
  const accountId = identity.account_id;
  // Student-only accounts can sign in only after the owner enables the
  // student rollout switch; the response stays indistinguishable from a
  // wrong password.
  if (!isStaffRoleSet(identity.role_names)) {
    try {
      const { data, error } = await serviceClient(env).rpc("public_feature_state");
      const features = Array.isArray(data) ? data[0] : data;
      if (error) {
        diagnostics.record("lookup_unavailable", "unavailable", { accountId });
        return jsonResponse({ error: "unavailable" }, 503);
      }
      if (features?.student_sign_in !== true) {
        diagnostics.record("student_sign_in_off", "rejected", { accountId });
        return genericFailure(startedAt);
      }
    } catch {
      diagnostics.record("lookup_unavailable", "unavailable", { accountId });
      return jsonResponse({ error: "unavailable" }, 503);
    }
  }

  let authResult;
  try {
    authResult = await anonymousAuthClient(env).auth.signInWithPassword({
      email: identity.provider_email,
      password,
    });
  } catch {
    diagnostics.record("provider_unavailable", "rejected", { accountId });
    return genericFailure(startedAt);
  }

  const issued = await issueBffSession(env, identity, authResult, {
    mustChangePassword: identity.force_password_change === true,
  });
  if (!issued.ok) {
    diagnostics.record(issued.stage, issued.outcome, { accountId });
    return issued.outcome === "unavailable"
      ? jsonResponse({ error: "unavailable" }, 503)
      : genericFailure(startedAt);
  }
  // Auth accepted the password: give a student's limiter attempt back. Staff
  // keep it counted, because their TOTP checks share the same allowance.
  if (!isStaffRoleSet(identity.role_names)) await releaseLoginAttempt(request, env, username);
  diagnostics.record("signed_in", "success", { accountId });
  return jsonResponse(issued.payload, 200, { "Set-Cookie": issued.cookie });
}
