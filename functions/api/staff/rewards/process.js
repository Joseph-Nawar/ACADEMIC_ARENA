import { userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { requireStaff, rpcFailure } from "../../../lib/route-auth.js";
import { validPeriodKey, validPeriodLabel, validPublication } from "../../../lib/rewards.js";
import { hasExactKeys, readJsonBody } from "../../../lib/validation.js";

// Grant (or, with mode "reconcile", correct) the rewards of the live verified
// publication for one earning period. Idempotent; refused by the database
// unless the owner has switched cosmetic rewards on.
export async function onRequestPost({ request, env }) {
  const auth = await requireStaff(request, env, "rewards.process", { mutation: true });
  if (auth.response) return auth.response;
  const body = await readJsonBody(request, 512);
  // expectedChanges: the exact count the staff member confirmed from the preview.
  if (!hasExactKeys(body, ["publicationId", "periodKey", "periodLabel", "mode", "expectedChanges"]) || !validPublication(body.publicationId) ||
      !validPeriodKey(body.periodKey) || !validPeriodLabel(body.periodLabel) || !["grant", "reconcile"].includes(body.mode) ||
      !Number.isSafeInteger(body.expectedChanges) || body.expectedChanges < 0 || body.expectedChanges > 10000) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken).rpc("process_rank_rewards", {
    p_snapshot_id: body.publicationId, p_period_key: body.periodKey.trim().toLowerCase(), p_period_label: body.periodLabel, p_mode: body.mode,
    p_expected_changes: body.expectedChanges,
  });
  if (error) return rpcFailure(error);
  const n = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  return jsonResponse({
    result: { period: data?.period, version: n(data?.version), mode: data?.mode,
      granted: n(data?.granted), regranted: n(data?.regranted), revoked: n(data?.revoked), equippedFallbacks: n(data?.equippedFallbacks) },
  });
}
