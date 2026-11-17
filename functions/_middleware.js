import { addApiHeaders, jsonResponse } from "./lib/response.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith("/api/")) return context.next();
  try {
    const response = await context.next();
    // Unknown /api paths fall through to the static SPA fallback (HTML 200);
    // an API path must never answer with the application shell.
    const htmlFallback = (response.headers.get("Content-Type") || "").startsWith("text/html");
    if (response.status === 404 || response.status === 405 || htmlFallback) {
      return jsonResponse({ error: "not_found" }, htmlFallback ? 404 : response.status);
    }
    return addApiHeaders(response);
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
}
