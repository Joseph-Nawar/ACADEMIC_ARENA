import { decodeJwt } from "jose";
import { configuration } from "./env.js";
import { decryptSessionSecret, sha256Bytea } from "./secure-crypto.js";
import { serviceClient, verifyProviderUser } from "./provider.js";
import { isStaffRoleSet, listSessionMfaFactors } from "./staff-mfa.js";

const SESSION_COOKIE = "__Host-aa_session";
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/u;

export function sessionCookieFromRequest(request) {
  const header = request.headers.get("Cookie") || "";
  const values = header.split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))
    .map((part) => part.slice(SESSION_COOKIE.length + 1));
  if (values.length === 0) return { present: false, token: null };
  if (values.length !== 1 || !TOKEN_FORMAT.test(values[0])) return { present: true, token: null };
  return { present: true, token: values[0] };
}

export async function resolveSession(request, env) {
  const cookie = sessionCookieFromRequest(request);
  if (!cookie.token) return { session: null, hadCookie: cookie.present };
  const config = configuration(env);
  const tokenHash = await sha256Bytea(cookie.token);
  const client = serviceClient(env);
  const { data, error } = await client.rpc("resolve_bff_session", { p_session_token_hash: tokenHash });
  if (error) throw new Error("Session store is unavailable.");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { session: null, hadCookie: true };

  try {
    const accessToken = await decryptSessionSecret(row.provider_access_token_jwe, config.sessionJweKey, "AA-ACCESS");
    const csrfToken = await decryptSessionSecret(row.csrf_token_jwe, config.sessionJweKey, "AA-CSRF");
    const refreshToken = row.provider_refresh_token_jwe
      ? await decryptSessionSecret(row.provider_refresh_token_jwe, config.sessionJweKey, "AA-REFRESH")
      : null;
    const [verified, claims] = await Promise.all([
      verifyProviderUser(env, accessToken),
      Promise.resolve(decodeJwt(accessToken)),
    ]);
    const expiresAt = Number(claims.exp) * 1000;
    if (verified.status >= 500 || verified.status === 0 || verified.status === 429) {
      throw new Error("Identity provider is temporarily unavailable.");
    }
    if (!verified.user || verified.user.id !== row.provider_user_id ||
        claims.session_id !== row.provider_session_id ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
        !Array.isArray(row.role_names) || row.role_names.length === 0) {
      await revokeSession(env, tokenHash, "provider_error");
      return { session: null, hadCookie: true };
    }

    let hasVerifiedTotp = false;
    if (isStaffRoleSet(row.role_names)) {
      let factors;
      try {
        factors = await listSessionMfaFactors(env, accessToken, refreshToken);
      } catch (factorError) {
        if ([0, 429].includes(factorError?.status) || factorError?.status >= 500) {
          throw new Error("Identity provider is temporarily unavailable.");
        }
        await revokeSession(env, tokenHash, "provider_error");
        return { session: null, hadCookie: true };
      }
      hasVerifiedTotp = factors.verifiedTotp.length > 0;
    }
    const assuranceLevel = claims.aal === "aal2" && hasVerifiedTotp ? "aal2" : "aal1";

    return {
      hadCookie: true,
      session: {
        tokenHash,
        token: cookie.token,
        accountId: row.account_id,
        providerUserId: row.provider_user_id,
        providerSessionId: row.provider_session_id,
        providerAccessToken: accessToken,
        providerRefreshToken: refreshToken,
        providerExpiresAt: expiresAt,
        expiresAt: Date.parse(row.expires_at),
        csrfToken,
        csrfTokenHash: row.csrf_token_hash,
        roleNames: row.role_names,
        mustChangePassword: row.force_password_change === true,
        assuranceLevel,
        mfaRequired: isStaffRoleSet(row.role_names) && assuranceLevel !== "aal2",
        mfaSetupRequired: isStaffRoleSet(row.role_names) && !hasVerifiedTotp,
      },
    };
  } catch (error) {
    if (error?.message === "Identity provider is temporarily unavailable.") throw error;
    await revokeSession(env, tokenHash, "provider_error");
    return { session: null, hadCookie: true };
  }
}

export async function revokeSession(env, tokenHash, reason) {
  const { error } = await serviceClient(env).rpc("revoke_bff_session", {
    p_session_token_hash: tokenHash,
    p_reason: reason,
  });
  if (error) throw new Error("Session revocation is unavailable.");
}

export function safeRole(roles) {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("publisher")) return "publisher";
  if (roles.includes("moderator")) return "moderator";
  return "student";
}
