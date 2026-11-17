const API_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
});

export function jsonResponse(payload, status = 200, headers = {}) {
  const resultHeaders = new Headers(API_HEADERS);
  resultHeaders.set("Content-Type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(headers)) resultHeaders.set(name, value);
  return new Response(JSON.stringify(payload), { status, headers: resultHeaders });
}

export function emptyResponse(status = 204, headers = {}) {
  const resultHeaders = new Headers(API_HEADERS);
  for (const [name, value] of Object.entries(headers)) resultHeaders.set(name, value);
  return new Response(null, { status, headers: resultHeaders });
}

export function addApiHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(API_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function sessionCookie(value, maxAgeSeconds) {
  const safeAge = Math.max(0, Math.min(8 * 60 * 60, Math.floor(maxAgeSeconds)));
  return `__Host-aa_session=${value}; Max-Age=${safeAge}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export function clearSessionCookie() {
  return "__Host-aa_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict";
}
