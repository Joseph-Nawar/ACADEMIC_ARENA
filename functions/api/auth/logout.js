import { validCsrfRequest, sameOriginRequest } from "../../lib/csrf.js";
import { emptyResponse, clearSessionCookie, jsonResponse } from "../../lib/response.js";
import { resolveSession, revokeSession } from "../../lib/session.js";
import { revokeProviderRefreshToken } from "../../lib/provider.js";

export async function onRequestPost({ request, env }) {
  if (!sameOriginRequest(request)) return jsonResponse({ error: "request_rejected" }, 403);

  const { session } = await resolveSession(request, env);
  if (!session) return emptyResponse(204, { "Set-Cookie": clearSessionCookie() });
  if (!await validCsrfRequest(request, session)) return jsonResponse({ error: "request_rejected" }, 403);

  await revokeSession(env, session.tokenHash, "logout");
  await revokeProviderRefreshToken(env, session.providerAccessToken, session.providerRefreshToken);
  return emptyResponse(204, { "Set-Cookie": clearSessionCookie() });
}
