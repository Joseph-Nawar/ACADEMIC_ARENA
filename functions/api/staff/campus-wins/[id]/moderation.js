import { userAuthClient } from "../../../../lib/provider.js";
import { jsonResponse } from "../../../../lib/response.js";
import { UUID_PATTERN, requireStaff, rpcFailure } from "../../../../lib/route-auth.js";
import { hasExactKeys, readJsonBody } from "../../../../lib/validation.js";

export async function onRequestPost({ request, env, params }) {
  const auth = await requireStaff(request, env, "campus_wins.moderate", { mutation: true });
  if (auth.response) return auth.response;
  const id = String(params.id || "");
  const body = await readJsonBody(request, 256);
  if (!UUID_PATTERN.test(id) || !hasExactKeys(body, ["decision"]) ||
      !["approved", "rejected", "hidden", "removed"].includes(body.decision)) {
    return jsonResponse({ error: "invalid_moderation" }, 400);
  }
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken)
    .rpc("moderate_campus_win", { p_submission_id: id, p_decision: body.decision });
  if (error) return rpcFailure(error);
  return jsonResponse({ status: data });
}
