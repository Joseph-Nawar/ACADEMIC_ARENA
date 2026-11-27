import { userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { requireStaff, rpcFailure } from "../../../lib/route-auth.js";
import { previewFromRow, validPeriodKey, validPublication } from "../../../lib/rewards.js";
import { hasExactKeys, readJsonBody } from "../../../lib/validation.js";

// What processing would do, in aggregate. Grants nothing.
export async function onRequestPost({ request, env }) {
  const auth = await requireStaff(request, env, "rewards.process", { mutation: true });
  if (auth.response) return auth.response;
  const body = await readJsonBody(request, 512);
  if (!hasExactKeys(body, ["publicationId", "periodKey"]) || !validPublication(body.publicationId) || !validPeriodKey(body.periodKey)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken)
    .rpc("preview_rank_rewards", { p_snapshot_id: body.publicationId, p_period_key: body.periodKey });
  if (error) return rpcFailure(error);
  return jsonResponse({ preview: previewFromRow(data) });
}
