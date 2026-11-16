import { authorizeStaffMutation } from "../../../lib/authorization.js";
import { serviceClient, userAuthClient } from "../../../lib/provider.js";
import { configuration } from "../../../lib/env.js";
import { decryptSessionSecret, encryptSessionSecret, randomOpaqueToken } from "../../../lib/secure-crypto.js";
import { jsonResponse } from "../../../lib/response.js";
import { findLoginIdentity } from "../../../lib/staff-accounts.js";
import { hasExactKeys, isFictionalFixtureEmail, normalizeUsername, readJsonBody } from "../../../lib/validation.js";

export async function onRequestPost({ request, env }) {
  const authorization = await authorizeStaffMutation(request, env, "accounts.recover");
  if (authorization.response) return authorization.response;
  if (env.ENVIRONMENT !== "test") {
    return jsonResponse({ error: "external_identity_authorization_required" }, 403);
  }

  const body = await readJsonBody(request, 1024);
  const username = hasExactKeys(body, ["username"]) ? normalizeUsername(body.username) : null;
  if (!username) return jsonResponse({ error: "invalid_account" }, 400);

  let identity;
  try {
    identity = await findLoginIdentity(env, username);
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
  if (!identity || identity.account_status !== "active" || !isFictionalFixtureEmail(identity.provider_email)) {
    return jsonResponse({ error: "account_not_available" }, 404);
  }

  let proposedPassword;
  let passwordJwe;
  try {
    proposedPassword = randomOpaqueToken();
    passwordJwe = await encryptSessionSecret(
      proposedPassword,
      configuration(env).sessionJweKey,
      "AA-Recovery-Password",
    );
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
  let data;
  let error;
  try {
    ({ data, error } = await userAuthClient(env, authorization.session.providerAccessToken)
      .rpc("force_password_change_for_account", { p_username: username, p_password_jwe: passwordJwe }));
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
  if (error) return jsonResponse({ error: "unavailable" }, 503);
  if (data !== true) return jsonResponse({ error: "account_not_available" }, 404);

  let recoveryState;
  let initialPassword;
  let provider;
  try {
    provider = serviceClient(env);
    const { data: operation, error: operationError } = await provider.rpc("resolve_credential_sync_operation", {
      p_account_id: identity.account_id,
      p_operation_kind: "student_password_recovery",
    });
    recoveryState = Array.isArray(operation) ? operation[0] || null : operation || null;
    if (operationError || !recoveryState || recoveryState.provider_user_id !== identity.provider_user_id ||
        !Number.isSafeInteger(recoveryState.credential_epoch) || typeof recoveryState.password_jwe !== "string") {
      return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
    }
    initialPassword = await decryptSessionSecret(
      recoveryState.password_jwe,
      configuration(env).sessionJweKey,
      "AA-Recovery-Password",
    );
  } catch {
    return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  }

  try {
    const { error: resetError } = await provider.auth.admin.updateUserById(identity.provider_user_id, {
      password: initialPassword,
    });
    if (resetError) return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  } catch {
    return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  }

  let finalized;
  let finalizeError;
  try {
    ({ data: finalized, error: finalizeError } = await provider.rpc("complete_student_password_recovery", {
      p_account_id: identity.account_id,
      p_expected_credential_epoch: recoveryState.credential_epoch,
    }));
  } catch {
    return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  }
  if (finalizeError || finalized !== true) {
    return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  }
  return jsonResponse({ recovered: true, username, initialPassword });
}
