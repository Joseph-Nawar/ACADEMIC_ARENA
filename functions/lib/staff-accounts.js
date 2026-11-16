import { serviceClient } from "./provider.js";

export async function findLoginIdentity(env, username) {
  const { data, error } = await serviceClient(env).rpc("resolve_login_identity", { p_username: username });
  if (error) throw new Error("Account lookup is unavailable.");
  const row = Array.isArray(data) ? data[0] || null : data || null;
  return row;
}

export async function findAccountIdentity(env, accountId) {
  const { data, error } = await serviceClient(env).rpc("resolve_account_identity", {
    p_account_id: accountId,
  });
  if (error) throw new Error("Account lookup is unavailable.");
  return Array.isArray(data) ? data[0] || null : data || null;
}
