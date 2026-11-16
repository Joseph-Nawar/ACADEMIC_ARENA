import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import * as OTPAuth from "otpauth";
import { createIdentity, json, local, setFictionalAccountRole } from "./bff-fixtures.mjs";

async function directRpc(name, body, accessToken) {
  return fetch(new URL(`/rest/v1/rpc/${name}`, local.supabaseUrl), {
    method: "POST",
    headers: {
      apikey: local.anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("AAL2 staff cannot bypass the disabled hosted account-lifecycle gate through PostgREST", async (context) => {
  const identity = await createIdentity(context, "lifecycle-gate");
  setFictionalAccountRole(identity.accountId, "admin");
  const auth = createClient(local.supabaseUrl, local.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const signedIn = await auth.auth.signInWithPassword({ email: identity.email, password: identity.password });
  assert.equal(signedIn.error, null);
  const enrolled = await auth.auth.mfa.enroll({ factorType: "totp", friendlyName: "local gate test" });
  assert.equal(enrolled.error, null);
  const totp = OTPAuth.URI.parse(enrolled.data.totp.uri);
  const verified = await auth.auth.mfa.challengeAndVerify({
    factorId: enrolled.data.id,
    code: totp.generate(),
  });
  assert.equal(verified.error, null);
  assert.ok(verified.data.access_token, "local Supabase returns an AAL2 user JWT");

  for (const [name, body] of [
    ["provision_student_account", {
      p_provider_user_id: identity.user.id,
      p_username: "direct.bypass",
      p_provider_email: identity.email,
    }],
    ["force_password_change_for_account", { p_username: identity.username, p_password_jwe: "x".repeat(64) }],
    ["suspend_student_account", { p_username: identity.username }],
    ["reset_staff_mfa_for_account", { p_username: identity.username }],
  ]) {
    const response = await directRpc(name, body, verified.data.access_token);
    const payload = await json(response);
    assert.equal(response.status, 403, `${name} is blocked by the database environment gate`);
    assert.equal(payload.code, "42501", `${name} returns a permission error without revealing account state`);
  }
});
