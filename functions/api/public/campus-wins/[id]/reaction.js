import { userAuthClient } from "../../../../lib/provider.js";
import { jsonResponse } from "../../../../lib/response.js";
import { UUID_PATTERN, requireStudent, rpcFailure } from "../../../../lib/route-auth.js";
import { hasExactKeys, readJsonBody } from "../../../../lib/validation.js";

export async function onRequestPut({ request, env, params }) {
  const auth = await requireStudent(request, env, { mutation: true });
  if (auth.response) return auth.response;
  const postId = String(params.id || "");
  const body = await readJsonBody(request, 256);
  if (!UUID_PATTERN.test(postId) || !hasExactKeys(body, ["reaction"]) || !["heart", "clap", "fire"].includes(body.reaction)) {
    return jsonResponse({ error: "invalid_reaction" }, 400);
  }
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken)
    .rpc("set_campus_win_reaction", { p_post_id: postId, p_reaction: body.reaction });
  if (error) return rpcFailure(error);
  return jsonResponse({ activeReaction: data ?? null });
}
