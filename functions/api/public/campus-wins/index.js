import { TEMPLATE_CATEGORIES, displayDate } from "../../../lib/campus-wins.js";
import { publicConfig } from "../../../lib/character-v2.js";
import { anonymousAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { CHARACTER_BADGES, CHARACTER_FAMILIES, CHARACTER_IDS, CHARACTER_TONES } from "../../../lib/validation.js";

// Issue #25: a win shows its author's *current* saved look only while the
// author is active and has given the separate Campus Wins consent. Otherwise
// a neutral figure (no character fields). The look stored when the win was
// approved is never used.
function postCharacter(post) {
  const v2 = post.character_v2 ? publicConfig(post.character_v2) : null;
  if (v2) return { v2 };
  if (CHARACTER_IDS.has(post.avatar_key) && CHARACTER_FAMILIES.has(post.avatar_family) &&
      CHARACTER_TONES.has(post.avatar_tone) && CHARACTER_BADGES.has(post.avatar_badge)) {
    return { avatar: post.avatar_key, style: post.avatar_family, tone: post.avatar_tone, badge: post.avatar_badge };
  }
  return {};
}

export async function onRequestGet({ request, env }) {
  const category = new URL(request.url).searchParams.get("category") || "all";
  if (!["all", "academic", "consistency", "community"].includes(category)) {
    return jsonResponse({ error: "invalid_filter" }, 400);
  }
  const templates = Object.keys(TEMPLATE_CATEGORIES).filter((key) => category === "all" || TEMPLATE_CATEGORIES[key] === category);
  const client = anonymousAuthClient(env);
  let { data, error } = await client.rpc("public_campus_wins_v2", { p_templates: templates });
  if (error?.code === "PGRST202") {
    // Database not yet migrated: fail closed to neutral figures rather than
    // show the possibly outdated, unconsented look stored at approval.
    ({ data, error } = await client
      .from("campus_wins_public")
      .select("post_id,template_key,public_author_name,published_at,heart_count,clap_count,fire_count")
      .in("template_key", templates)
      .order("published_at", { ascending: false })
      .limit(60));
  }
  if (error || !Array.isArray(data)) return jsonResponse({ error: "unavailable" }, 503);
  return jsonResponse({
    posts: data.map((post) => ({
      id: post.post_id,
      author: post.public_author_name,
      ...postCharacter(post),
      type: post.template_key,
      created: displayDate(post.published_at),
      counts: [post.heart_count, post.clap_count, post.fire_count],
    })),
  });
}
