import { sameOriginRequest, validCsrfRequest } from "./csrf.js";
import { authorizeStaffMutation, hasServerPermission } from "./authorization.js";
import { clearSessionCookie, jsonResponse } from "./response.js";
import { resolveSession } from "./session.js";

function unauthorized(hadCookie) {
  return jsonResponse({ error: "unauthorized" }, 401, hadCookie ? { "Set-Cookie": clearSessionCookie() } : {});
}

// Staff reads need the same role and AAL2 as mutations, but no CSRF token.
export async function requireStaff(request, env, permission, { mutation }) {
  if (mutation) return authorizeStaffMutation(request, env, permission);
  const { session, hadCookie } = await resolveSession(request, env);
  if (!session) return { response: unauthorized(hadCookie), session: null };
  if (!hasServerPermission(session, permission)) return { response: jsonResponse({ error: "forbidden" }, 403), session: null };
  return { response: null, session };
}

export async function requireStudent(request, env, { mutation }) {
  if (mutation && !sameOriginRequest(request)) return { response: jsonResponse({ error: "request_rejected" }, 403), session: null };
  const { session, hadCookie } = await resolveSession(request, env);
  if (!session) return { response: unauthorized(hadCookie), session: null };
  if (mutation && !await validCsrfRequest(request, session)) {
    return { response: jsonResponse({ error: "request_rejected" }, 403), session: null };
  }
  if (!session.roleNames.includes("student")) return { response: jsonResponse({ error: "forbidden" }, 403), session: null };
  if (session.mustChangePassword) return { response: jsonResponse({ error: "password_change_required" }, 409), session: null };
  return { response: null, session };
}

const RPC_ERRORS = Object.freeze({
  42501: [403, "forbidden"],
  AAW01: [409, "submission_pending"],
  AAW02: [429, "weekly_limit"],
  AAW03: [409, "public_name_required"],
  AAW04: [409, "invalid_transition"],
  AAW05: [404, "not_found"],
  22023: [400, "invalid_request"],
  "22P02": [400, "invalid_request"],
  23502: [400, "invalid_request"],
  23505: [400, "invalid_request"],
  23514: [400, "invalid_request"],
});

export function rpcFailure(error) {
  const [status, code] = RPC_ERRORS[error?.code] || [503, "unavailable"];
  return jsonResponse({ error: code }, status);
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
