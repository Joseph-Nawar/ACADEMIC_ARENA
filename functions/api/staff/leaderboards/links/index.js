import { userAuthClient } from "../../../../lib/provider.js";
import { jsonResponse } from "../../../../lib/response.js";
import { requireStaff, rpcFailure, UUID_PATTERN } from "../../../../lib/route-auth.js";

// Admin-only (AAL2): current private links of one publication (no emails).
export async function onRequestGet({ request, env }) {
  const auth = await requireStaff(request, env, "leaderboards.link", { mutation: false });
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const id = params.get("publicationId");
  if ([...params.keys()].some((key) => key !== "publicationId") || !UUID_PATTERN.test(String(id))) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken)
    .rpc("list_level_row_links", { p_snapshot_id: id });
  if (error) return rpcFailure(error);
  return jsonResponse({ links: data.map((row) => ({ level: row.level, position: row.position, publicName: row.public_name, username: row.username })) });
}
