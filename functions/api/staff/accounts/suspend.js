import { authorizeStaffMutation } from "../../../lib/authorization.js";
import { serviceClient, userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { findLoginIdentity } from "../../../lib/staff-accounts.js";
import { hasExactKeys, isFictionalFixtureEmail, normalizeUsername, readJsonBody } from "../../../lib/validation.js";

export async function onRequestPost({ request, env }) {
  const authorization = await authorizeStaffMutation(request, env, "accounts.suspend");
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

  const { data, error } = await userAuthClient(env, authorization.session.providerAccessToken)
    .rpc("suspend_student_account", { p_username: username });
  if (error) return jsonResponse({ error: "unavailable" }, 503);
  if (data !== true) return jsonResponse({ error: "account_not_available" }, 404);

  const { error: banError } = await serviceClient(env).auth.admin.updateUserById(identity.provider_user_id, {
    ban_duration: "876000h",
  });
  if (banError) return jsonResponse({ error: "suspension_applied_provider_sync_pending" }, 503);
  return jsonResponse({ suspended: true });
}
