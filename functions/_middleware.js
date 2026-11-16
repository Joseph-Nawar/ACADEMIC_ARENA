import { addApiHeaders, jsonResponse } from "./lib/response.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith("/api/")) return context.next();
  try {
    const response = await context.next();
    if (response.status === 404 || response.status === 405) {
      return jsonResponse({ error: "not_found" }, response.status);
    }
    return addApiHeaders(response);
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
}
