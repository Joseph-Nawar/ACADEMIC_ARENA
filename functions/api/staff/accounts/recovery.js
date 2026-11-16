import { authorizeStaffMutation } from "../../../lib/authorization.js";
import { providerReturnedHttpResponse, serviceClient, userAuthClient } from "../../../lib/provider.js";
import { configuration } from "../../../lib/env.js";
import { decryptSessionSecret, encryptSessionSecret, randomOpaqueToken, sha256Bytea } from "../../../lib/secure-crypto.js";
import { jsonResponse } from "../../../lib/response.js";
import { findLoginIdentity } from "../../../lib/staff-accounts.js";
import { hasExactKeys, isFictionalFixtureEmail, normalizeUsername, readJsonBody } from "../../../lib/validation.js";

async function releaseClaim(provider, accountId, credentialEpoch, leaseTokenHash) {
  try {
    await provider.rpc("release_credential_sync_operation", {
      p_account_id: accountId,
      p_operation_kind: "student_password_recovery",
      p_expected_credential_epoch: credentialEpoch,
      p_lease_token_hash: leaseTokenHash,
    });
  } catch {
    // A lost release response leaves the account fail-closed; no new generation can claim this operation.
  }
}

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
  let leaseTokenHash;
  let provider;
  try {
    provider = serviceClient(env);
    leaseTokenHash = (await sha256Bytea(randomOpaqueToken())).slice(2);
    const { data: operation, error: operationError } = await provider.rpc("claim_credential_sync_operation", {
      p_account_id: identity.account_id,
      p_operation_kind: "student_password_recovery",
      p_lease_token_hash: leaseTokenHash,
    });
    recoveryState = Array.isArray(operation) ? operation[0] || null : operation || null;
    if (operationError) {
      await releaseClaim(provider, identity.account_id, null, leaseTokenHash);
      return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
    }
    if (!recoveryState) {
      return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
    }
    if (recoveryState.provider_user_id !== identity.provider_user_id ||
        !Number.isSafeInteger(recoveryState.credential_epoch) || typeof recoveryState.password_jwe !== "string") {
      if (Number.isSafeInteger(recoveryState.credential_epoch)) {
        await releaseClaim(provider, identity.account_id, recoveryState.credential_epoch, leaseTokenHash);
      }
      return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
    }
    initialPassword = await decryptSessionSecret(
      recoveryState.password_jwe,
      configuration(env).sessionJweKey,
      "AA-Recovery-Password",
    );
  } catch {
    if (recoveryState && Number.isSafeInteger(recoveryState.credential_epoch) && leaseTokenHash && provider) {
      await releaseClaim(provider, identity.account_id, recoveryState.credential_epoch, leaseTokenHash);
    } else if (leaseTokenHash && provider) {
      await releaseClaim(provider, identity.account_id, null, leaseTokenHash);
    }
    return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  }

  try {
    const { error: resetError } = await provider.auth.admin.updateUserById(identity.provider_user_id, {
      password: initialPassword,
    });
    if (resetError) {
      if (providerReturnedHttpResponse(resetError)) {
        await releaseClaim(provider, identity.account_id, recoveryState.credential_epoch, leaseTokenHash);
      }
      return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
    }
  } catch {
    return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  }

  let finalized;
  let finalizeError;
  try {
    ({ data: finalized, error: finalizeError } = await provider.rpc("complete_student_password_recovery", {
      p_account_id: identity.account_id,
      p_expected_credential_epoch: recoveryState.credential_epoch,
      p_lease_token_hash: leaseTokenHash,
    }));
  } catch {
    await releaseClaim(provider, identity.account_id, recoveryState.credential_epoch, leaseTokenHash);
    return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  }
  if (finalizeError || finalized !== true) {
    await releaseClaim(provider, identity.account_id, recoveryState.credential_epoch, leaseTokenHash);
    return jsonResponse({ error: "recovery_applied_password_sync_pending" }, 503);
  }
  return jsonResponse({ recovered: true, username, initialPassword });
}
