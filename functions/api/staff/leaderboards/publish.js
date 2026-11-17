import { userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { UUID_PATTERN, requireStaff, rpcFailure } from "../../../lib/route-auth.js";
import { hasExactKeys, readJsonBody } from "../../../lib/validation.js";

// Publishes a draft, or rolls back to an earlier publication, atomically.
export async function onRequestPost({ request, env }) {
  const auth = await requireStaff(request, env, "leaderboards.publish", { mutation: true });
  if (auth.response) return auth.response;
  const body = await readJsonBody(request, 256);
  if (!hasExactKeys(body, ["publicationId"]) || !UUID_PATTERN.test(String(body.publicationId))) {
    return jsonResponse({ error: "invalid_publication" }, 400);
  }
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken)
    .rpc("publish_leaderboard_snapshot", { p_snapshot_id: body.publicationId });
  if (error) return rpcFailure(error);
  return jsonResponse({ published: true, version: data });
}
