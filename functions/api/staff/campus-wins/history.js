import { listModeration } from "../../../lib/moderation.js";
import { jsonResponse } from "../../../lib/response.js";

export function onRequestGet({ request, env }) {
  const status = new URL(request.url).searchParams.get("status") || "approved";
  if (!["approved", "hidden", "rejected", "removed"].includes(status)) return jsonResponse({ error: "invalid_filter" }, 400);
  return listModeration(request, env, status);
}
