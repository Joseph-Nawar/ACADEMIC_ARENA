import { parseLinkCsv } from "../../../../lib/leaderboard-csv.js";
import { userAuthClient } from "../../../../lib/provider.js";
import { jsonResponse } from "../../../../lib/response.js";
import { requireStaff, rpcFailure, UUID_PATTERN } from "../../../../lib/route-auth.js";
import { hasExactKeys, readJsonBody } from "../../../../lib/validation.js";

// Admin-only (AAL2): preview private account links for one level-only
// publication. Shows the approved identity privately so staff can verify it.
export async function onRequestPost({ request, env }) {
  const auth = await requireStaff(request, env, "leaderboards.link", { mutation: true });
  if (auth.response) return auth.response;
  const body = await readJsonBody(request, 8 * 1024);
  if (!hasExactKeys(body, ["publicationId", "csv"]) || !UUID_PATTERN.test(String(body.publicationId)) || typeof body.csv !== "string") {
    return jsonResponse({ error: "invalid_upload", errors: [{ line: 0, message: "Choose a publication and a level,rank,username file." }] }, 400);
  }
  const parsed = parseLinkCsv(body.csv);
  if (!parsed.ok) return jsonResponse({ error: "invalid_upload", errors: parsed.errors }, 422);
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken)
    .rpc("preview_level_row_links", { p_snapshot_id: body.publicationId, p_links: parsed.links });
  if (error) {
    if (error.code === "22023") return jsonResponse({ error: "invalid_upload", errors: [{ line: 0, message: error.message }] }, 422);
    return rpcFailure(error);
  }
  return jsonResponse({
    links: data.map((row) => ({
      level: row.level, position: row.position, publicName: row.public_name, username: row.username,
      providerEmail: row.provider_email, accountStatus: row.account_status, previous: row.previous_state,
    })),
  });
}
