import { diffBoards, parseRankingCsv, validAcademicYear, MAX_CSV_BYTES } from "../../../lib/leaderboard-csv.js";
import { userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { requireStaff, rpcFailure } from "../../../lib/route-auth.js";
import { hasExactKeys, readJsonBody } from "../../../lib/validation.js";

// Validates an uploaded ranking file and stores it as an unpublished draft.
// The raw file is never stored; only the validated public fields are.
export async function onRequestPost({ request, env }) {
  const auth = await requireStaff(request, env, "leaderboards.publish", { mutation: true });
  if (auth.response) return auth.response;
  // JSON escaping can roughly double a CSV's size; the parser re-checks 256 KB.
  const body = await readJsonBody(request, MAX_CSV_BYTES * 2 + 4096);
  if (!hasExactKeys(body, ["academicYear", "csv"]) || typeof body.csv !== "string") {
    return jsonResponse({ error: "invalid_upload", errors: [{ line: 0, message: "Upload a CSV file of at most 256 KB." }] }, 400);
  }
  if (!validAcademicYear(body.academicYear)) {
    return jsonResponse({ error: "invalid_upload", errors: [{ line: 0, message: "Academic year must look like 2026-27." }] }, 400);
  }
  const parsed = parseRankingCsv(body.csv);
  if (!parsed.ok) return jsonResponse({ error: "invalid_upload", errors: parsed.errors }, 422);

  const client = userAuthClient(env, auth.session.providerAccessToken);
  const { data: created, error } = await client.rpc("create_leaderboard_draft", {
    p_academic_year: body.academicYear,
    p_rows: parsed.rows,
  });
  if (error) {
    if (["22023", "23505", "23514"].includes(error.code)) {
      return jsonResponse({ error: "invalid_upload", errors: [{ line: 0, message: "The database rejected the rankings. Check ranks, names, and labels." }] }, 422);
    }
    return rpcFailure(error);
  }
  const draft = Array.isArray(created) ? created[0] : created;

  let liveRows = [];
  const { data: history, error: historyError } = await client.rpc("list_leaderboard_publications");
  if (historyError) return rpcFailure(historyError);
  const live = history.find((item) => item.state === "live");
  if (live) {
    const { data: rows, error: rowsError } = await client.rpc("leaderboard_snapshot_rows", { p_snapshot_id: live.id });
    if (rowsError) return rpcFailure(rowsError);
    liveRows = rows;
  }
  return jsonResponse({
    draft: { id: draft.draft_id, version: draft.version_number, rowCount: draft.row_count, boardCount: draft.board_count },
    liveVersion: live?.version_number ?? null,
    diff: diffBoards(liveRows, parsed.rows),
  }, 201);
}
