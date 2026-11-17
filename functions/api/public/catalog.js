import { anonymousAuthClient } from "../../lib/provider.js";
import { jsonResponse } from "../../lib/response.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const level = url.searchParams.get("level");
  const semester = url.searchParams.get("semester");
  if (!["4", "5", "6"].includes(level) || !["1", "2"].includes(semester)) {
    return jsonResponse({ error: "invalid_filters" }, 400);
  }
  const { data, error } = await anonymousAuthClient(env).rpc("public_leaderboard_catalog", {
    p_level: Number(level),
    p_semester: Number(semester),
  });
  if (error || !Array.isArray(data)) return jsonResponse({ error: "unavailable" }, 503);
  const groups = new Map();
  const modules = {};
  for (const row of data) {
    if (!groups.has(row.cohort_key)) groups.set(row.cohort_key, { key: row.cohort_key, label: row.cohort_label, semesterBoard: false });
    if (row.board_kind === "semester") groups.get(row.cohort_key).semesterBoard = true;
    if (row.board_kind === "module") {
      modules[row.cohort_key] ||= [];
      modules[row.cohort_key].push({ key: row.module_key, label: row.module_label });
    }
  }
  return jsonResponse({ groups: [...groups.values()], modules });
}
