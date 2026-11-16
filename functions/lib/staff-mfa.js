import { userSessionClient } from "./provider.js";

export function isStaffRoleSet(roleNames) {
  return Array.isArray(roleNames) && roleNames.some((role) =>
    ["moderator", "publisher", "admin"].includes(role));
}

export async function listSessionMfaFactors(env, accessToken, refreshToken) {
  const client = await userSessionClient(env, accessToken, refreshToken);
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) {
    const failure = new Error("The authentication provider could not list MFA factors.");
    failure.status = typeof error.status === "number" ? error.status : 0;
    throw failure;
  }
  return {
    client,
    verifiedTotp: Array.isArray(data?.totp) ? data.totp : [],
    pendingTotp: Array.isArray(data?.all)
      ? data.all.filter((factor) => factor.factor_type === "totp" && factor.status === "unverified")
      : [],
  };
}
