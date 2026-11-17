import { userAuthClient } from "../../lib/provider.js";
import { jsonResponse } from "../../lib/response.js";
import { requireStudent, rpcFailure } from "../../lib/route-auth.js";
import { hasExactKeys, readJsonBody } from "../../lib/validation.js";
import { TEMPLATE_CATEGORIES, displayDate } from "../../lib/campus-wins.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireStudent(request, env, { mutation: false });
  if (auth.response) return auth.response;
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken).rpc("my_campus_wins");
  if (error || !Array.isArray(data)) return rpcFailure(error);
  return jsonResponse({
    submissions: data.map((item) => ({ id: item.id, type: item.template_key, status: item.status, created: displayDate(item.created_at) })),
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireStudent(request, env, { mutation: true });
  if (auth.response) return auth.response;
  const body = await readJsonBody(request, 256);
  if (!hasExactKeys(body, ["type"]) || !Object.hasOwn(TEMPLATE_CATEGORIES, body.type)) {
    return jsonResponse({ error: "invalid_achievement" }, 400);
  }
  const { data, error } = await userAuthClient(env, auth.session.providerAccessToken)
    .rpc("submit_campus_win", { p_template_key: body.type });
  if (error) return rpcFailure(error);
  return jsonResponse({ state: "pending", id: data }, 201);
}
