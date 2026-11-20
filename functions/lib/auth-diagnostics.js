import { serviceClient } from "./provider.js";

// Private reason codes for sign-in and password-change outcomes, so a failed
// sign-in can be investigated without guessing. The browser always gets the
// same generic response; only the server records which stage decided it.
// Never pass credentials, tokens, emails, IPs or student IDs here: the
// database row holds a reason code, a random correlation ID and, when known,
// the internal account ID. The username (when given) is used only to find the
// account and is not stored.
export function authDiagnostics(context, flow) {
  const correlationId = crypto.randomUUID();
  let recorded = false;
  return {
    correlationId,
    record(stage, outcome, { accountId = null, username = null } = {}) {
      if (recorded) return;
      recorded = true;
      console.log(JSON.stringify({ event: "aa_auth", flow, stage, outcome, ref: correlationId }));
      let task;
      try {
        task = serviceClient(context.env).rpc("record_auth_diagnostic", {
          p_correlation_id: correlationId,
          p_flow: flow,
          p_stage: stage,
          p_outcome: outcome,
          p_account_id: accountId,
          p_username: typeof username === "string" ? username : null,
        }).then(() => undefined, () => undefined);
      } catch {
        return;
      }
      // Recorded after the response, so it never changes response timing.
      if (typeof context.waitUntil === "function") context.waitUntil(task);
    },
  };
}
