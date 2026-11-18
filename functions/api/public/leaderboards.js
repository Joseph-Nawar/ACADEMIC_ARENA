import { anonymousAuthClient } from "../../lib/provider.js";
import { jsonResponse } from "../../lib/response.js";

// Fixed rank-to-artwork mapping for level-only boards. The source data has no
// avatars; this is generic illustration chosen by rank only, never from a name.
const RANK_ARTWORK = Object.freeze([
  ["amara", "ink"], ["omar", "ink"], ["mariam", "ink"], ["youssef", "cartoon3d"], ["tariq", "cartoon3d"],
  ["habiba2", "cartoon3d"], ["malek", "ink"], ["nour2", "ink"], ["zein", "cartoon3d"], ["amara", "cartoon3d"],
]);

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  const level = params.get("level");
  if (![...params.keys()].every((name) => name === "level") || params.getAll("level").length !== 1 ||
      !["4", "5", "6"].includes(level)) {
    return jsonResponse({ error: "invalid_filters" }, 400);
  }
  const { data, error } = await anonymousAuthClient(env).rpc("public_level_leaderboard", { p_level: Number(level) });
  if (error || !Array.isArray(data)) return jsonResponse({ error: "unavailable" }, 503);
  const published = data[0]?.published_at ? new Date(data[0].published_at).toISOString().slice(0, 10) : null;
  return jsonResponse({
    level: Number(level),
    releaseLabel: data[0]?.release_label ?? null,
    publishedAt: published,
    rows: data.map((row) => {
      const [avatar, style] = RANK_ARTWORK[row.position - 1];
      return { position: row.position, name: row.public_name, avatar, style };
    }),
  });
}
