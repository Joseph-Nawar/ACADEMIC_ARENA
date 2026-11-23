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
  const client = userAuthClient(env, session.providerAccessToken);
  const { data, error } = await client
    .from("student_avatar_configs")
    .select("character_key,family,tone,badge,show_on_leaderboard")
    .maybeSingle();
  if (error) throw new Error("Avatar data is unavailable.");
  return {
    avatar: avatarFromRow(data),
    showOnLeaderboard: data?.show_on_leaderboard === true,
    publication: await publicationState(client),
  };
}

// Whether the board actually shows this student's character, decided by the
// database from the same projection anonymous visitors read. Never guessed
// here or in the browser. "unknown" if the state cannot be read right now.
const PUBLICATION_STATES = new Set(["not_saved", "saved_private", "display_off", "awaiting_link", "public"]);
async function publicationState(client) {
  const { data, error } = await client.rpc("my_character_publication_state");
  return !error && PUBLICATION_STATES.has(data) ? data : "unknown";
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
    return jsonResponse(await ownedAvatar(env, session));
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

  // { avatar } keeps the current public-display choice; { avatar, showOnLeaderboard }
  // changes it. Only allowlisted keys are accepted; no paths, URLs, or markup.
  const body = await readJsonBody(request, 1024);
  const withChoice = hasExactKeys(body, ["avatar", "showOnLeaderboard"]);
  const avatar = withChoice || hasExactKeys(body, ["avatar"]) ? normalizeAvatar(body.avatar) : null;
  if (!avatar || (withChoice && typeof body.showOnLeaderboard !== "boolean")) {
    return jsonResponse({ error: "invalid_avatar" }, 400);
  }

  try {
    const client = userAuthClient(env, session.providerAccessToken);
    const showOnLeaderboard = withChoice ? body.showOnLeaderboard : (await ownedAvatar(env, session)).showOnLeaderboard;
    const { data, error } = await client.rpc("save_own_avatar_preferences", {
      p_character_key: avatar.base,
      p_family: avatar.style,
      p_tone: avatar.tone,
      p_badge: avatar.badge,
      p_show_on_leaderboard: showOnLeaderboard,
    });
    if (error || data !== true) return jsonResponse({ error: "avatar_save_failed" }, 403);
    const saved = await ownedAvatar(env, session);
    if (!saved.avatar) return jsonResponse({ error: "avatar_save_failed" }, 403);
    return jsonResponse({ saved: true, ...saved });
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
}
