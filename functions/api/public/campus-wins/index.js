import { TEMPLATE_CATEGORIES, displayDate } from "../../../lib/campus-wins.js";
import { anonymousAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";

export async function onRequestGet({ request, env }) {
  const category = new URL(request.url).searchParams.get("category") || "all";
  if (!["all", "academic", "consistency", "community"].includes(category)) {
    return jsonResponse({ error: "invalid_filter" }, 400);
  }
  const templates = Object.keys(TEMPLATE_CATEGORIES).filter((key) => category === "all" || TEMPLATE_CATEGORIES[key] === category);
  const { data, error } = await anonymousAuthClient(env)
    .from("campus_wins_public")
    .select("post_id,template_key,public_author_name,avatar_key,avatar_family,published_at,heart_count,clap_count,fire_count")
    .in("template_key", templates)
    .order("published_at", { ascending: false })
    .limit(60);
  if (error || !Array.isArray(data)) return jsonResponse({ error: "unavailable" }, 503);
  return jsonResponse({
    posts: data.map((post) => ({
      id: post.post_id,
      author: post.public_author_name,
      avatar: post.avatar_key,
      style: post.avatar_family,
      type: post.template_key,
      created: displayDate(post.published_at),
      counts: [post.heart_count, post.clap_count, post.fire_count],
    })),
  });
}
