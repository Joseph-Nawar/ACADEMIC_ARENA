import { userAuthClient } from "../../lib/provider.js";
import { jsonResponse } from "../../lib/response.js";
import { requireStudent, rpcFailure } from "../../lib/route-auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireStudent(request, env, { mutation: false });
  if (auth.response) return auth.response;
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken).rpc("my_campus_win_reactions");
  if (error || !Array.isArray(data)) return rpcFailure(error);
  return jsonResponse({ reactions: Object.fromEntries(data.map((item) => [item.post_id, item.reaction_key])) });
}
