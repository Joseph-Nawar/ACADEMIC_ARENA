import { authorizeStaffMutation } from "../../../lib/authorization.js";
import { serviceClient, userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { findAccountIdentity, findLoginIdentity } from "../../../lib/staff-accounts.js";
import { hasExactKeys, isFictionalFixtureEmail, normalizeUsername, readJsonBody } from "../../../lib/validation.js";

export async function onRequestPost({ request, env }) {
  const authorization = await authorizeStaffMutation(request, env, "accounts.mfa_reset");
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
  if (!identity || identity.account_status !== "active" || !isFictionalFixtureEmail(identity.provider_email) ||
      identity.account_id === authorization.session.accountId ||
      !Array.isArray(identity.role_names) || !identity.role_names.some((role) => ["moderator", "publisher", "admin"].includes(role))) {
    return jsonResponse({ error: "account_not_available" }, 404);
  }

  const { data: reset, error: resetError } = await userAuthClient(env, authorization.session.providerAccessToken)
    .rpc("reset_staff_mfa_for_account", { p_username: username });
  if (resetError) return jsonResponse({ error: "account_not_available" }, 404);
  if (reset !== true) return jsonResponse({ error: "account_not_available" }, 404);

  let resetState;
  try {
    resetState = await findAccountIdentity(env, identity.account_id);
  } catch {
    return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
  }
  if (!resetState || resetState.account_status !== "active" ||
      resetState.credential_update_pending !== true || !Number.isSafeInteger(resetState.credential_epoch)) {
    return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
  }

  try {
    const provider = serviceClient(env);
    const { data, error } = await provider.auth.admin.mfa.listFactors({ userId: identity.provider_user_id });
    if (error || !Array.isArray(data?.factors)) return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
    for (const factor of data.factors) {
      const { error: deleteError } = await provider.auth.admin.mfa.deleteFactor({
        userId: identity.provider_user_id,
        id: factor.id,
      });
      if (deleteError) return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
    }
  } catch {
    return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
  }

  const { data: finalized, error: finalizeError } = await serviceClient(env).rpc("complete_staff_mfa_reset", {
    p_account_id: identity.account_id,
    p_expected_credential_epoch: resetState.credential_epoch,
  });
  if (finalizeError || finalized !== true) return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
  return jsonResponse({ mfaReset: true, username });
}
