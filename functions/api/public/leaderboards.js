import { anonymousAuthClient } from "../../lib/provider.js";
import { jsonResponse } from "../../lib/response.js";
import { CHARACTER_BADGES, CHARACTER_FAMILIES, CHARACTER_IDS, CHARACTER_TONES } from "../../lib/validation.js";

// Default artwork for level-only boards: a fixed rank-to-illustration mapping,
// never inferred from a name. A linked, opted-in student's own allowlisted
// character replaces it (resolved in the database; no identifiers returned).
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
  const { data, error } = await anonymousAuthClient(env).rpc("public_level_leaderboard_v2", { p_level: Number(level) });
  if (error || !Array.isArray(data)) return jsonResponse({ error: "unavailable" }, 503);
  const published = data[0]?.published_at ? new Date(data[0].published_at).toISOString().slice(0, 10) : null;
  return jsonResponse({
    level: Number(level),
    releaseLabel: data[0]?.release_label ?? null,
    publishedAt: published,
    rows: data.map((row) => {
      const chosen = CHARACTER_IDS.has(row.avatar_key) && CHARACTER_FAMILIES.has(row.avatar_family) &&
        CHARACTER_TONES.has(row.avatar_tone) && CHARACTER_BADGES.has(row.avatar_badge);
      if (chosen) {
        return { position: row.position, name: row.public_name, avatar: row.avatar_key, style: row.avatar_family,
          tone: row.avatar_tone, badge: row.avatar_badge, personalized: true };
      }
      const [avatar, style] = RANK_ARTWORK[row.position - 1];
      return { position: row.position, name: row.public_name, avatar, style, personalized: false };
    }),
  });
}
