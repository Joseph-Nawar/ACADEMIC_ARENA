import { diffLevels, parseLevelCsv, validAcademicYear, validReleaseLabel } from "../../../lib/leaderboard-csv.js";
import { userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { requireStaff, rpcFailure } from "../../../lib/route-auth.js";
import { hasExactKeys, readJsonBody } from "../../../lib/validation.js";

// Validates a level-only ranking file (level,rank,public_name; 10 per Level
// 4/5/6) and stores it as an unpublished draft. The raw file is never stored.
export async function onRequestPost({ request, env }) {
  const auth = await requireStaff(request, env, "leaderboards.publish", { mutation: true });
  if (auth.response) return auth.response;
  const body = await readJsonBody(request, 64 * 1024);
  const invalid = (message) => jsonResponse({ error: "invalid_upload", errors: [{ line: 0, message }] }, 400);
  if (!hasExactKeys(body, ["academicYear", "releaseLabel", "csv"]) || typeof body.csv !== "string") {
    return invalid("Upload a CSV file of at most 16 KB with an academic year and release label.");
  }
  if (!validAcademicYear(body.academicYear)) return invalid("Academic year must look like 2026-27.");
  if (!validReleaseLabel(body.releaseLabel)) return invalid("Release label must be short plain text, for example: Week 5.");
  const parsed = parseLevelCsv(body.csv);
  if (!parsed.ok) return jsonResponse({ error: "invalid_upload", errors: parsed.errors }, 422);

  const client = userAuthClient(env, auth.session.providerAccessToken);
  const { data: created, error } = await client.rpc("create_level_leaderboard_draft", {
    p_academic_year: body.academicYear,
    p_release_label: body.releaseLabel,
    p_rows: parsed.rows,
  });
  if (error) {
    if (["22023", "23505", "23514"].includes(error.code)) {
      return jsonResponse({ error: "invalid_upload", errors: [{ line: 0, message: "The database rejected the rankings. Check ranks and names." }] }, 422);
    }
    return rpcFailure(error);
  }
  const draft = Array.isArray(created) ? created[0] : created;

  const { data: history, error: historyError } = await client.rpc("list_level_leaderboard_publications");
  if (historyError) return rpcFailure(historyError);
  const live = history.find((item) => item.state === "live" && item.board_format === "level_only");
  let liveRows = [];
  if (live) {
    const { data: rows, error: rowsError } = await client.rpc("level_leaderboard_snapshot_rows", { p_snapshot_id: live.id });
    if (rowsError) return rpcFailure(rowsError);
    liveRows = rows;
  }
  return jsonResponse({
    draft: { id: draft.draft_id, version: draft.version_number, rowCount: draft.row_count, releaseLabel: body.releaseLabel },
    liveVersion: live?.version_number ?? null,
    diff: diffLevels(liveRows, parsed.rows),
  }, 201);
}
