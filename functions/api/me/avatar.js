import { sameOriginRequest, validCsrfRequest } from "../../lib/csrf.js";
import { clearSessionCookie, jsonResponse } from "../../lib/response.js";
import { userAuthClient } from "../../lib/provider.js";
import { resolveSession } from "../../lib/session.js";
import { hasExactKeys, normalizeAvatar, readJsonBody } from "../../lib/validation.js";

function avatarFromRow(row) {
  if (!row || typeof row !== "object") return null;
  const avatar = normalizeAvatar({
    base: row.character_key,
    style: row.family,
    tone: row.tone,
    badge: row.badge,
  });
  return avatar;
}

async function ownedAvatar(env, session) {
  const { data, error } = await userAuthClient(env, session.providerAccessToken)
    .from("student_avatar_configs")
    .select("character_key,family,tone,badge")
    .maybeSingle();
  if (error) throw new Error("Avatar data is unavailable.");
  return avatarFromRow(data);
}

function authenticatedRole(session) {
  return session?.roleNames?.includes("student") === true;
}

export async function onRequestGet({ request, env }) {
  const { session, hadCookie } = await resolveSession(request, env);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401, hadCookie ? { "Set-Cookie": clearSessionCookie() } : {});
  if (!authenticatedRole(session)) return jsonResponse({ error: "forbidden" }, 403);
  if (session.mustChangePassword) return jsonResponse({ error: "password_change_required" }, 409);
  try {
    return jsonResponse({ avatar: await ownedAvatar(env, session) });
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
}

export async function onRequestPut({ request, env }) {
  if (!sameOriginRequest(request)) return jsonResponse({ error: "request_rejected" }, 403);
  const { session, hadCookie } = await resolveSession(request, env);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401, hadCookie ? { "Set-Cookie": clearSessionCookie() } : {});
  if (!await validCsrfRequest(request, session)) return jsonResponse({ error: "request_rejected" }, 403);
  if (!authenticatedRole(session)) return jsonResponse({ error: "forbidden" }, 403);
  if (session.mustChangePassword) return jsonResponse({ error: "password_change_required" }, 409);

  const body = await readJsonBody(request, 1024);
  const avatar = hasExactKeys(body, ["avatar"]) ? normalizeAvatar(body.avatar) : null;
  if (!avatar) return jsonResponse({ error: "invalid_avatar" }, 400);

  try {
    const client = userAuthClient(env, session.providerAccessToken);
    const { data, error } = await client.rpc("save_own_avatar_config", {
      p_character_key: avatar.base,
      p_family: avatar.style,
      p_tone: avatar.tone,
      p_badge: avatar.badge,
    });
    if (error || data !== true) return jsonResponse({ error: "avatar_save_failed" }, 403);
    const savedAvatar = await ownedAvatar(env, session);
    if (!savedAvatar) return jsonResponse({ error: "avatar_save_failed" }, 403);
    return jsonResponse({ saved: true, avatar: savedAvatar });
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
}
