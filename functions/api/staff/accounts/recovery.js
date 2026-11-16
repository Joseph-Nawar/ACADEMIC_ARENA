import { authorizeStaffMutation } from "../../../lib/authorization.js";
import { serviceClient, userAuthClient } from "../../../lib/provider.js";
import { randomOpaqueToken } from "../../../lib/secure-crypto.js";
import { jsonResponse } from "../../../lib/response.js";
import { findAccountIdentity, findLoginIdentity } from "../../../lib/staff-accounts.js";
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

  const initialPassword = randomOpaqueToken();
  const { data, error } = await userAuthClient(env, authorization.session.providerAccessToken)
    .rpc("force_password_change_for_account", { p_username: username });
  if (error) return jsonResponse({ error: "unavailable" }, 503);
  if (data !== true) return jsonResponse({ error: "account_not_available" }, 404);

  let recoveryState;
  try {
    recoveryState = await findAccountIdentity(env, identity.account_id);
  } catch {
    return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  }
  if (!recoveryState || recoveryState.account_status !== "active" ||
      recoveryState.credential_update_pending !== true || !Number.isSafeInteger(recoveryState.credential_epoch)) {
    return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  }

  const { error: resetError } = await serviceClient(env).auth.admin.updateUserById(identity.provider_user_id, {
    password: initialPassword,
  });
  if (resetError) return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);

  const { data: finalized, error: finalizeError } = await serviceClient(env).rpc("complete_student_password_recovery", {
    p_account_id: identity.account_id,
    p_expected_credential_epoch: recoveryState.credential_epoch,
  });
  if (finalizeError || finalized !== true) {
    return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  }
  return jsonResponse({ recovered: true, username, initialPassword });
}
