import { displayDate } from "./campus-wins.js";
import { userAuthClient } from "./provider.js";
import { jsonResponse } from "./response.js";
import { requireStaff, rpcFailure } from "./route-auth.js";

export async function listModeration(request, env, status) {
  const auth = await requireStaff(request, env, "campus_wins.moderate", { mutation: false });
  if (auth.response) return auth.response;
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken)
    .rpc("list_campus_win_moderation", { p_status: status });
  if (error || !Array.isArray(data)) return rpcFailure(error);
  return jsonResponse({
    posts: data.map((item) => ({
      id: item.id,
      author: item.author_name,
      avatar: item.avatar_key,
      style: item.avatar_family,
      type: item.template_key,
      status: item.status,
      created: displayDate(item.created_at),
      moderated: item.moderated_at ? displayDate(item.moderated_at) : null,
      counts: [0, 0, 0],
    })),
  });
}
