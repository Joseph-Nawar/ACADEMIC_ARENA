import { userAuthClient } from "../../../lib/provider.js";
import { jsonResponse } from "../../../lib/response.js";
import { requireStaff, rpcFailure } from "../../../lib/route-auth.js";
import { hasExactKeys, normalizeUsername, readJsonBody } from "../../../lib/validation.js";

const PUBLIC_NAME = /^\p{L}[\p{L}\p{M} .'’-]{0,59}$/u;

// Sets the canonical, staff-approved public name used on Campus Wins.
export async function onRequestPost({ request, env }) {
  const auth = await requireStaff(request, env, "accounts.provision", { mutation: true });
  if (auth.response) return auth.response;
  const body = await readJsonBody(request, 512);
  const username = hasExactKeys(body, ["username", "publicName"]) ? normalizeUsername(body.username) : null;
  const publicName = typeof body?.publicName === "string" ? body.publicName.normalize("NFC").replace(/\s+/gu, " ").trim() : "";
  if (!username || !PUBLIC_NAME.test(publicName)) return jsonResponse({ error: "invalid_request" }, 400);
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken)
    .rpc("set_student_public_name", { p_username: username, p_public_name: publicName });
  if (error) return rpcFailure(error);
  if (data !== true) return jsonResponse({ error: "account_not_available" }, 404);
  return jsonResponse({ updated: true });
}
