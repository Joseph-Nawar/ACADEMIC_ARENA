import { anonymousAuthClient } from "../../lib/provider.js";
import { jsonResponse } from "../../lib/response.js";

const KEY = /^[a-z0-9][a-z0-9._-]{0,47}$/u;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const level = url.searchParams.get("level");
  const semester = url.searchParams.get("semester");
  const group = url.searchParams.get("group") || "";
  const kind = url.searchParams.get("kind");
  const moduleKey = url.searchParams.get("module") || "";
  if (!["4", "5", "6"].includes(level) || !["1", "2"].includes(semester) || !KEY.test(group) ||
      !["semester", "module"].includes(kind) || (kind === "module" ? !KEY.test(moduleKey) : moduleKey !== "")) {
    return jsonResponse({ error: "invalid_filters" }, 400);
  }
  const { data, error } = await anonymousAuthClient(env).rpc("public_leaderboard_board", {
    p_level: Number(level),
    p_semester: Number(semester),
    p_cohort_key: group,
    p_board_kind: kind,
    p_module_key: kind === "module" ? moduleKey : null,
  });
  if (error || !Array.isArray(data)) return jsonResponse({ error: "unavailable" }, 503);
  return jsonResponse({
    publishedAt: data[0]?.published_at ? new Date(data[0].published_at).toISOString().slice(0, 10) : null,
    rows: data.map((row) => ({ position: row.position, name: row.public_name, avatar: row.avatar_key, style: row.avatar_family })),
  });
}
