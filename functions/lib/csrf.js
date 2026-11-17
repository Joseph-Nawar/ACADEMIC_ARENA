import { constantTimeMatchesPostgresBytea, sha256Bytea } from "./secure-crypto.js";

const CSRF_FORMAT = /^[A-Za-z0-9_-]{43}$/u;

export function sameOriginRequest(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  let originUrl;
  let requestUrl;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }
  if (originUrl.origin !== requestUrl.origin || originUrl.username || originUrl.password) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin";
}

export async function validCsrfRequest(request, session) {
  if (!sameOriginRequest(request)) return false;
  const token = request.headers.get("X-CSRF-Token") || "";
  if (!CSRF_FORMAT.test(token)) return false;
  const providedHash = await sha256Bytea(token);
  return constantTimeMatchesPostgresBytea(providedHash, session.csrfTokenHash);
}
