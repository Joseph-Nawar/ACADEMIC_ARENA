import { clearSessionCookie } from "../../lib/response.js";
import { jsonResponse } from "../../lib/response.js";
import { resolveSession, safeRole } from "../../lib/session.js";

export async function onRequestGet({ request, env }) {
  const { session, hadCookie } = await resolveSession(request, env);
  if (!session) {
    return jsonResponse({ authenticated: false }, 200, hadCookie ? { "Set-Cookie": clearSessionCookie() } : {});
  }
  return jsonResponse({
    authenticated: true,
    user: {
      role: safeRole(session.roleNames),
      mustChangePassword: session.mustChangePassword,
    },
    csrfToken: session.csrfToken,
  });
}
