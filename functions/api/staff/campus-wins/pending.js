import { listModeration } from "../../../lib/moderation.js";

export function onRequestGet({ request, env }) {
  return listModeration(request, env, "pending");
}
