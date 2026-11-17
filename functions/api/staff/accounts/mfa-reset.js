import { authorizeStaffMutation } from "../../../lib/authorization.js";
import { serviceClient, userAuthClient } from "../../../lib/provider.js";
import { randomOpaqueToken, sha256Bytea } from "../../../lib/secure-crypto.js";
import { jsonResponse } from "../../../lib/response.js";
import { findLoginIdentity } from "../../../lib/staff-accounts.js";
import { hasExactKeys, isFictionalFixtureEmail, normalizeUsername, readJsonBody } from "../../../lib/validation.js";

async function releaseClaim(provider, accountId, credentialEpoch, leaseTokenHash) {
  try {
    await provider.rpc("release_credential_sync_operation", {
      p_account_id: accountId,
      p_operation_kind: "staff_mfa_reset",
      p_expected_credential_epoch: credentialEpoch,
      p_lease_token_hash: leaseTokenHash,
    });
  } catch {
    // A lost release response leaves the account fail-closed; no new generation can claim this operation.
  }
}

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

  let reset;
  let resetError;
  try {
    ({ data: reset, error: resetError } = await userAuthClient(env, authorization.session.providerAccessToken)
      .rpc("reset_staff_mfa_for_account", { p_username: username }));
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
  if (resetError) return jsonResponse({ error: "account_not_available" }, 404);
  if (reset !== true) return jsonResponse({ error: "account_not_available" }, 404);

  let resetState;
  let leaseTokenHash;
  let provider;
  try {
    provider = serviceClient(env);
    leaseTokenHash = (await sha256Bytea(randomOpaqueToken())).slice(2);
    const { data: operation, error: operationError } = await provider.rpc("claim_credential_sync_operation", {
      p_account_id: identity.account_id,
      p_operation_kind: "staff_mfa_reset",
      p_lease_token_hash: leaseTokenHash,
    });
    resetState = Array.isArray(operation) ? operation[0] || null : operation || null;
    if (operationError) {
      await releaseClaim(provider, identity.account_id, null, leaseTokenHash);
      return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
    }
  } catch {
    if (leaseTokenHash && provider) await releaseClaim(provider, identity.account_id, null, leaseTokenHash);
    return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
  }
  if (!resetState) {
    return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
  }
  if (resetState.provider_user_id !== identity.provider_user_id ||
      !Number.isSafeInteger(resetState.credential_epoch)) {
    if (Number.isSafeInteger(resetState.credential_epoch)) {
      await releaseClaim(provider, identity.account_id, resetState.credential_epoch, leaseTokenHash);
    }
    return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
  }

  // Releasing after any provider failure here is safe. Listing factors is a
  // read. Deleting is scoped to one existing factor ID, so a delayed delete can
  // only remove a factor this reset is meant to remove; factors enrolled later
  // get new IDs. A retry lists the remaining factors again.
  try {
    const { data, error } = await provider.auth.admin.mfa.listFactors({ userId: identity.provider_user_id });
    if (error || !Array.isArray(data?.factors)) {
      await releaseClaim(provider, identity.account_id, resetState.credential_epoch, leaseTokenHash);
      return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
    }
    for (const factor of data.factors) {
      const { error: deleteError } = await provider.auth.admin.mfa.deleteFactor({
        userId: identity.provider_user_id,
        id: factor.id,
      });
      if (deleteError) {
        await releaseClaim(provider, identity.account_id, resetState.credential_epoch, leaseTokenHash);
        return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
      }
    }
  } catch {
    await releaseClaim(provider, identity.account_id, resetState.credential_epoch, leaseTokenHash);
    return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
  }

  let finalized;
  let finalizeError;
  try {
    ({ data: finalized, error: finalizeError } = await provider.rpc("complete_staff_mfa_reset", {
      p_account_id: identity.account_id,
      p_expected_credential_epoch: resetState.credential_epoch,
      p_lease_token_hash: leaseTokenHash,
    }));
  } catch {
    await releaseClaim(provider, identity.account_id, resetState.credential_epoch, leaseTokenHash);
    return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
  }
  if (finalizeError || finalized !== true) {
    await releaseClaim(provider, identity.account_id, resetState.credential_epoch, leaseTokenHash);
    return jsonResponse({ error: "mfa_reset_sync_pending" }, 503);
  }
  return jsonResponse({ mfaReset: true, username });
}
