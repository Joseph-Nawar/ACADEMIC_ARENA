import { sameOriginRequest, validCsrfRequest } from "./csrf.js";
import { clearSessionCookie, jsonResponse } from "./response.js";
import { resolveSession } from "./session.js";
import { isStaffRoleSet } from "./staff-mfa.js";

export async function authorizeStaffMfaRequest(request, env) {
  if (!sameOriginRequest(request)) {
    return { response: jsonResponse({ error: "request_rejected" }, 403), session: null };
  }
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
  if (!isStaffRoleSet(session.roleNames)) {
    return { response: jsonResponse({ error: "forbidden" }, 403), session: null };
  }
  if (session.mustChangePassword) {
    return { response: jsonResponse({ error: "password_change_required" }, 409), session: null };
  }
  return { response: null, session };
}
