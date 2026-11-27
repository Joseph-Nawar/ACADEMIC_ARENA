import { userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { requireStaff, rpcFailure } from "../../../lib/route-auth.js";

// Earning periods with aggregate grant counts (AAL2 admin).
export async function onRequestGet({ request, env }) {
  const auth = await requireStaff(request, env, "rewards.process", { mutation: false });
  if (auth.response) return auth.response;
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken).rpc("list_reward_periods");
  if (error || !Array.isArray(data)) return rpcFailure(error);
  return jsonResponse({
    periods: data.map((period) => ({
      key: period.period_key, label: period.label, source: period.source_kind,
      versions: period.versions ?? [], active: period.active ?? {}, revoked: Number(period.revoked) || 0,
      lastProcessedAt: period.last_processed_at,
    })),
  });
}
