import { authorizeStaffMutation } from "../../lib/authorization.js";
import { jsonResponse } from "../../lib/response.js";
import { serviceClient, userAuthClient } from "../../lib/provider.js";
import { randomOpaqueToken } from "../../lib/secure-crypto.js";
import {
  hasExactKeys,
  isFictionalFixtureEmail,
  normalizeFictionalEmail,
  normalizeUsername,
  readJsonBody,
} from "../../lib/validation.js";

export async function onRequestPost({ request, env }) {
  const authorization = await authorizeStaffMutation(request, env, "accounts.provision");
  if (authorization.response) return authorization.response;
  if (env.ENVIRONMENT !== "test") {
    return jsonResponse({ error: "external_identity_authorization_required" }, 403);
  }

  const body = await readJsonBody(request, 2048);
  const username = hasExactKeys(body, ["username", "email"]) ? normalizeUsername(body.username) : null;
  const email = hasExactKeys(body, ["username", "email"]) ? normalizeFictionalEmail(body.email) : null;
  if (!username || !email || !isFictionalFixtureEmail(email)) {
    return jsonResponse({ error: "invalid_account" }, 400);
  }

  const initialPassword = randomOpaqueToken();
  let createdUser;
  try {
    const { data, error } = await serviceClient(env).auth.admin.createUser({
      email,
      password: initialPassword,
      email_confirm: true,
    });
    if (error || !data?.user?.id) return jsonResponse({ error: "account_not_created" }, 409);
    createdUser = data.user;
    const { data: provisioned, error: mappingError } = await userAuthClient(env, authorization.session.providerAccessToken)
      .rpc("provision_student_account", {
        p_provider_user_id: createdUser.id,
        p_username: username,
        p_provider_email: email,
      });
    if (mappingError || provisioned !== true) {
      await serviceClient(env).auth.admin.deleteUser(createdUser.id);
      return jsonResponse({ error: "account_not_created" }, 409);
    }
  } catch {
    if (createdUser?.id) {
      try { await serviceClient(env).auth.admin.deleteUser(createdUser.id); } catch {}
    }
    return jsonResponse({ error: "unavailable" }, 503);
  }

  return jsonResponse({ created: true, username, initialPassword }, 201);
}
