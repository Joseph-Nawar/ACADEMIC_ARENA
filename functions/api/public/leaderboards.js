import { anonymousAuthClient } from "../../lib/provider.js";
import { jsonResponse } from "../../lib/response.js";
import { CHARACTER_BADGES, CHARACTER_FAMILIES, CHARACTER_IDS, CHARACTER_TONES } from "../../lib/validation.js";
import { publicConfig } from "../../lib/character-v2.js";

// Artwork precedence for each row:
//   1. a linked, active, opted-in student's own look: their complete Character
//      V2 config ({ personalized: true, v2 }, re-validated against the trusted
//      catalogue) or their allowlisted classic character
//      ({ personalized: true, avatar, style, tone, badge });
//   2. the character staff approved for this exact publication row
//      ({ personalized: false, avatar });
//   3. neither: { personalized: false } and the page shows a neutral illustration.
// Nothing is inferred here from a name, rank, or any other record.
export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  const level = params.get("level");
  if (![...params.keys()].every((name) => name === "level") || params.getAll("level").length !== 1 ||
      !["4", "5", "6"].includes(level)) {
    return jsonResponse({ error: "invalid_filters" }, 400);
  }
  const client = anonymousAuthClient(env);
  // Newest projection first; older ones while a database is not yet migrated
  // (PostgREST PGRST202 = function not found). Older ones carry fewer fields.
  let data;
  let error;
  for (const name of ["public_level_leaderboard_v4", "public_level_leaderboard_v3", "public_level_leaderboard_v2", "public_level_leaderboard"]) {
    ({ data, error } = await client.rpc(name, { p_level: Number(level) }));
    if (error?.code !== "PGRST202") break;
  }
  if (error || !Array.isArray(data)) return jsonResponse({ error: "unavailable" }, 503);
  const published = data[0]?.published_at ? new Date(data[0].published_at).toISOString().slice(0, 10) : null;
  return jsonResponse({
    level: Number(level),
    releaseLabel: data[0]?.release_label ?? null,
    publishedAt: published,
    rows: data.map((row) => {
      const v2 = row.character_v2 ? publicConfig(row.character_v2) : null;
      if (v2) return { position: row.position, name: row.public_name, v2, personalized: true };
      const chosen = CHARACTER_IDS.has(row.avatar_key) && CHARACTER_FAMILIES.has(row.avatar_family) &&
        CHARACTER_TONES.has(row.avatar_tone) && CHARACTER_BADGES.has(row.avatar_badge);
      if (chosen) {
        return { position: row.position, name: row.public_name, avatar: row.avatar_key, style: row.avatar_family,
          tone: row.avatar_tone, badge: row.avatar_badge, personalized: true };
      }
      if (CHARACTER_IDS.has(row.default_avatar_key)) {
        return { position: row.position, name: row.public_name, avatar: row.default_avatar_key, personalized: false };
      }
      return { position: row.position, name: row.public_name, personalized: false };
    }),
  });
}
