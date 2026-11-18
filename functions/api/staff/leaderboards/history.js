import { userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { requireStaff, rpcFailure } from "../../../lib/route-auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireStaff(request, env, "leaderboards.publish", { mutation: false });
  if (auth.response) return auth.response;
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken).rpc("list_level_leaderboard_publications");
  if (error || !Array.isArray(data)) return rpcFailure(error);
  return jsonResponse({
    publications: data.map((item) => ({
      id: item.id,
      version: item.version_number,
      academicYear: item.academic_year,
      releaseLabel: item.release_label,
      format: item.board_format,
      state: item.state,
      publishedAt: item.published_at,
      createdAt: item.created_at,
      rowCount: item.row_count,
    })),
  });
}
