import { sameOriginRequest, validCsrfRequest } from "./csrf.js";
import { clearSessionCookie, jsonResponse } from "./response.js";
import { resolveSession } from "./session.js";

const ROLE_PERMISSIONS = Object.freeze({
  "accounts.provision": new Set(["admin"]),
  "accounts.recover": new Set(["admin"]),
  "accounts.suspend": new Set(["admin"]),
  "accounts.mfa_reset": new Set(["admin"]),
  "leaderboards.publish": new Set(["publisher", "admin"]),
  "campus_wins.moderate": new Set(["moderator", "admin"]),
});

export function hasServerPermission(session, permission) {
  const roles = ROLE_PERMISSIONS[permission];
  return Boolean(session && roles && session.mustChangePassword !== true &&
    session.assuranceLevel === "aal2" && session.roleNames.some((role) => roles.has(role)));
}

export async function authorizeStaffMutation(request, env, permission) {
  if (!sameOriginRequest(request)) return { response: jsonResponse({ error: "request_rejected" }, 403), session: null };
  const { session, hadCookie } = await resolveSession(request, env);
  if (!session) {
    return {
      response: jsonResponse({ error: "unauthorized" }, 401, hadCookie ? { "Set-Cookie": clearSessionCookie() } : {}),
      session: null,
    };
  }
  if (!await validCsrfRequest(request, session)) {
    return { response: jsonResponse({ error: "request_rejected" }, 403), session: null };
  }
  if (!hasServerPermission(session, permission)) {
    return { response: jsonResponse({ error: "forbidden" }, 403), session: null };
  }
  return { response: null, session };
}
