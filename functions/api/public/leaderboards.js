import { anonymousAuthClient } from "../../lib/provider.js";
import { jsonResponse } from "../../lib/response.js";
import { CHARACTER_BADGES, CHARACTER_FAMILIES, CHARACTER_IDS, CHARACTER_TONES } from "../../lib/validation.js";

// Rows carry artwork only when the database confirms a linked, active,
// opted-in student's own allowlisted character. Every other row is
// { position, name, personalized: false } and the page shows the anonymous
// competitor illustration: nothing is inferred from a name or rank.
export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  const level = params.get("level");
  if (![...params.keys()].every((name) => name === "level") || params.getAll("level").length !== 1 ||
      !["4", "5", "6"].includes(level)) {
    return jsonResponse({ error: "invalid_filters" }, 400);
  }
  const client = anonymousAuthClient(env);
  let { data, error } = await client.rpc("public_level_leaderboard_v2", { p_level: Number(level) });
  // Before migration 202611190001 is applied the V2 projection does not exist
  // (PostgREST PGRST202); serve the unchanged V1 rows with default artwork.
  if (error?.code === "PGRST202") ({ data, error } = await client.rpc("public_level_leaderboard", { p_level: Number(level) }));
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
      return { position: row.position, name: row.public_name, personalized: false };
    }),
  });
}
