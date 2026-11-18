import { anonymousAuthClient } from "../../lib/provider.js";
import { jsonResponse } from "../../lib/response.js";

// Non-sensitive rollout switches set by the database owner. Any failure
// reports every student feature as off.
export async function onRequestGet({ env }) {
  const off = { studentSignIn: false, avatarPersonalization: false, welcomeDialog: false };
  try {
    const { data, error } = await anonymousAuthClient(env).rpc("public_feature_state");
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return jsonResponse(off);
    return jsonResponse({
      studentSignIn: row.student_sign_in === true,
      avatarPersonalization: row.avatar_personalization === true,
      welcomeDialog: row.welcome_dialog === true,
    });
  } catch {
    return jsonResponse(off);
  }
}
