import { userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { requireStaff, rpcFailure, UUID_PATTERN } from "../../../lib/route-auth.js";
import { CHARACTER_IDS, hasExactKeys, readJsonBody } from "../../../lib/validation.js";

// Staff-reviewed default board characters for one level-only publication
// (AAL2 publisher or admin). Only allowlisted character keys are stored; any
// name-based suggestion stays in the reviewer's browser and is never sent.

export async function onRequestGet({ request, env }) {
  const auth = await requireStaff(request, env, "leaderboards.publish", { mutation: false });
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const id = params.get("publicationId");
  if ([...params.keys()].some((key) => key !== "publicationId") || !UUID_PATTERN.test(String(id))) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const client = userAuthClient(env, auth.session.providerAccessToken);
  const [rows, artwork] = await Promise.all([
    client.rpc("level_leaderboard_snapshot_rows", { p_snapshot_id: id }),
    client.rpc("list_level_row_artwork", { p_snapshot_id: id }),
  ]);
  if (rows.error) return rpcFailure(rows.error);
  if (artwork.error) return rpcFailure(artwork.error);
  const approved = new Map(artwork.data.map((row) => [`${row.level}:${row.position}`, row.character_key]));
  return jsonResponse({
    rows: rows.data.map((row) => ({
      level: row.level, position: row.position, publicName: row.public_name,
      character: approved.get(`${row.level}:${row.position}`) ?? null,
    })),
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireStaff(request, env, "leaderboards.publish", { mutation: true });
  if (auth.response) return auth.response;
  const body = await readJsonBody(request, 8 * 1024);
  const valid = hasExactKeys(body, ["publicationId", "assignments"]) && UUID_PATTERN.test(String(body.publicationId)) &&
    Array.isArray(body.assignments) && body.assignments.length <= 30 &&
    body.assignments.every((item) => hasExactKeys(item, ["level", "rank", "character"]) &&
      [4, 5, 6].includes(item.level) && Number.isInteger(item.rank) && item.rank >= 1 && item.rank <= 10 &&
      CHARACTER_IDS.has(item.character));
  if (!valid) return jsonResponse({ error: "invalid_request" }, 400);
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken)
    .rpc("approve_level_row_artwork", { p_snapshot_id: body.publicationId, p_rows: body.assignments });
  if (error) return rpcFailure(error);
  return jsonResponse({ approved: data });
}
