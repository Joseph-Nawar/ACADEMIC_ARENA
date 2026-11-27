import { userAuthClient } from "../../lib/provider.js";
import { jsonResponse } from "../../lib/response.js";
import { requireStudent, rpcFailure } from "../../lib/route-auth.js";
import { ownedCollections, publicConfig, validShape } from "../../lib/character-v2.js";
import { normalizeAvatar, hasExactKeys, readJsonBody } from "../../lib/validation.js";

// The signed-in student's characters (classic and V2), which one is shown,
// both public consents, and their server-owned inventory. Never returns a
// rank, a link, a username or any academic data.
const PUBLICATION_STATES = new Set(["not_saved", "saved_private", "display_off", "awaiting_link", "public"]);

async function characterState(client) {
  const [{ data, error }, publication] = await Promise.all([
    client.rpc("my_character_v2"),
    client.rpc("my_character_publication_state"),
  ]);
  if (error || !data || typeof data !== "object") throw new Error("Character data is unavailable.");
  const owned = ownedCollections(data.owned);
  const classic = data.classic ? normalizeAvatar(data.classic) : null;
  // A stored V2 look that this build cannot validate is reported, never drawn.
  const v2 = data.v2 == null ? null : publicConfig(data.v2, owned);
  return {
    saved: data.saved === true,
    activeLook: data.activeLook === "v2" ? "v2" : data.activeLook === "classic" ? "classic" : null,
    revision: Number.isSafeInteger(data.revision) && data.revision >= 0 ? data.revision : 0,
    classic,
    v2,
    v2Unreadable: data.v2 != null && v2 === null,
    showOnLeaderboard: data.showOnLeaderboard === true,
    showOnCampusWins: data.showOnCampusWins === true,
    studioEnabled: data.studioEnabled === true,
    owned,
    grants: Array.isArray(data.grants)
      ? data.grants.filter((grant) => owned.includes(grant?.collection) && typeof grant.period === "string")
        .slice(0, 50)
        .map((grant) => ({ collection: grant.collection, period: grant.period.slice(0, 48), grantedAt: String(grant.grantedAt).slice(0, 10) }))
      : [],
    publication: !publication.error && PUBLICATION_STATES.has(publication.data) ? publication.data : "unknown",
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireStudent(request, env, { mutation: false });
  if (auth.response) return auth.response;
  try {
    return jsonResponse(await characterState(userAuthClient(env, auth.session.providerAccessToken)));
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
}

// { expectedRevision, activeLook, v2, showOnLeaderboard, showOnCampusWins }
// v2: a complete config, or null to keep the stored V2 look unchanged.
export async function onRequestPut({ request, env }) {
  const auth = await requireStudent(request, env, { mutation: true });
  if (auth.response) return auth.response;
  const body = await readJsonBody(request, 2048);
  const shaped = hasExactKeys(body, ["expectedRevision", "activeLook", "v2", "showOnLeaderboard", "showOnCampusWins"]) &&
    Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 0 &&
    ["classic", "v2"].includes(body.activeLook) &&
    typeof body.showOnLeaderboard === "boolean" && typeof body.showOnCampusWins === "boolean";
  const v2 = shaped && body.v2 !== null ? validShape(body.v2) : null;
  if (!shaped || (body.v2 !== null && !v2)) return jsonResponse({ error: "invalid_character" }, 400);

  const client = userAuthClient(env, auth.session.providerAccessToken);
  const { error } = await client.rpc("save_own_character_v2", {
    p_expected_revision: body.expectedRevision,
    p_v2_config: v2,
    p_active_look: body.activeLook,
    p_show_on_leaderboard: body.showOnLeaderboard,
    p_show_on_campus_wins: body.showOnCampusWins,
  });
  if (error) return rpcFailure(error);
  try {
    return jsonResponse({ saved: true, ...await characterState(client) });
  } catch {
    // Saved, but the fresh state could not be read: the browser must reload it.
    return jsonResponse({ saved: true, stale: true });
  }
}
