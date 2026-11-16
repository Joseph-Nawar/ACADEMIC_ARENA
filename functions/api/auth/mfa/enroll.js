import { authorizeStaffMfaRequest } from "../../../lib/mfa-authorization.js";
import { serviceClient } from "../../../lib/provider.js";
import { listSessionMfaFactors } from "../../../lib/staff-mfa.js";
import { jsonResponse } from "../../../lib/response.js";
import { findAccountIdentity } from "../../../lib/staff-accounts.js";
import { consumeLoginAttempt } from "../../../lib/rate-limit.js";
import { hasExactKeys, readJsonBody } from "../../../lib/validation.js";

export async function onRequestPost({ request, env }) {
  const { response, session } = await authorizeStaffMfaRequest(request, env);
  if (response) return response;
  const body = await readJsonBody(request, 128);
  if (!hasExactKeys(body, [])) return jsonResponse({ error: "invalid_request" }, 400);

  try {
    const identity = await findAccountIdentity(env, session.accountId);
    if (!identity || identity.account_status !== "active") return jsonResponse({ error: "forbidden" }, 403);
    if (!await consumeLoginAttempt(request, env, identity.username_normalized)) {
      return jsonResponse({ error: "mfa_attempt_limited" }, 429);
    }
    const factors = await listSessionMfaFactors(env, session.providerAccessToken, session.providerRefreshToken);
    if (factors.verifiedTotp.length > 0) return jsonResponse({ error: "mfa_already_configured" }, 409);

    for (const factor of factors.pendingTotp) {
      const { error } = await factors.client.auth.mfa.unenroll({ factorId: factor.id });
      if (error) return jsonResponse({ error: "mfa_unavailable" }, 503);
    }
    const { data, error } = await factors.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Academic Arena staff authenticator",
    });
    if (error || data?.type !== "totp" || typeof data?.totp?.secret !== "string" || typeof data?.totp?.uri !== "string") {
      return jsonResponse({ error: "mfa_unavailable" }, 503);
    }
    const { error: auditError } = await serviceClient(env).rpc("record_staff_mfa_event", {
      p_account_id: session.accountId,
      p_action_key: "staff.mfa_enrollment_started",
    });
    if (auditError) return jsonResponse({ error: "mfa_unavailable" }, 503);
    return jsonResponse({ secret: data.totp.secret, totpUri: data.totp.uri });
  } catch {
    return jsonResponse({ error: "mfa_unavailable" }, 503);
  }
}
