import { userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { requireStaff, rpcFailure } from "../../../lib/route-auth.js";
import { readJsonBody } from "../../../lib/validation.js";

// Takes the live rankings down; the public site then shows the empty state.
export async function onRequestPost({ request, env }) {
  const auth = await requireStaff(request, env, "leaderboards.publish", { mutation: true });
  if (auth.response) return auth.response;
  const body = await readJsonBody(request, 64);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken).rpc("withdraw_current_leaderboard");
  if (error) return rpcFailure(error);
  return jsonResponse({ withdrawn: data === true });
}
