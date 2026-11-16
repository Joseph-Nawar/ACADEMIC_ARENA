import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import * as OTPAuth from "otpauth";
import {
  api,
  createIdentity,
  json,
  local,
  serviceRpc,
  setFictionalAccountRole,
} from "./bff-fixtures.mjs";

const origin = new URL(local.pagesUrl).origin;

async function postgrestRpc(name, body, accessToken) {
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

function cookieFrom(response) {
  const value = (response.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(value, /^__Host-aa_session=[A-Za-z0-9_-]{43}$/u);
  return value;
}

test("provider recovery blocks login/password changes until the matching reset is finalized", async (context) => {
  const student = await createIdentity(context, "recovery-race-student");
  const oldLogin = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": "192.0.2.71" },
    body: { username: student.username, password: student.password },
  });
  assert.equal(oldLogin.status, 200);
  const oldCookie = cookieFrom(oldLogin);

  const administrator = await createIdentity(context, "recovery-race-admin");
  setFictionalAccountRole(administrator.accountId, "admin");
  const auth = createClient(local.supabaseUrl, local.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const signedIn = await auth.auth.signInWithPassword({ email: administrator.email, password: administrator.password });
  assert.equal(signedIn.error, null);
  const enrolled = await auth.auth.mfa.enroll({ factorType: "totp", friendlyName: "local recovery race test" });
  assert.equal(enrolled.error, null);
  const factor = OTPAuth.URI.parse(enrolled.data.totp.uri);
  const verified = await auth.auth.mfa.challengeAndVerify({
    factorId: enrolled.data.id,
    code: factor.generate(),
  });
  assert.equal(verified.error, null);
  assert.ok(verified.data.access_token, "local Supabase provides an actual AAL2 staff token");

  const started = await postgrestRpc("force_password_change_for_account", {
    p_username: student.username,
    p_password_jwe: "a".repeat(64),
  }, verified.data.access_token);
  assert.equal(started.status, 200);
  assert.equal(await json(started), true);
  const concurrentRecovery = await postgrestRpc("force_password_change_for_account", {
    p_username: student.username,
    p_password_jwe: "b".repeat(64),
  }, verified.data.access_token);
  assert.equal(concurrentRecovery.status, 200);
  assert.equal(await json(concurrentRecovery), true, "a retry resumes the existing provider reset");

  const identityResponse = await serviceRpc("resolve_account_identity", { p_account_id: student.accountId });
  assert.equal(identityResponse.ok, true);
  const identityRows = await json(identityResponse);
  const recoveryState = Array.isArray(identityRows) ? identityRows[0] : identityRows;
  assert.equal(recoveryState.credential_epoch, 1);
  assert.equal(recoveryState.credential_update_pending, true);
  const leaseTokenHash = "a".repeat(64);
  const storedOperation = await serviceRpc("claim_credential_sync_operation", {
    p_account_id: student.accountId,
    p_operation_kind: "student_password_recovery",
    p_lease_token_hash: leaseTokenHash,
  });
  assert.equal(storedOperation.ok, true);
  const operationRows = await json(storedOperation);
  const operation = Array.isArray(operationRows) ? operationRows[0] : operationRows;
  assert.equal(operation.password_jwe, "a".repeat(64), "retry retains only the first encrypted credential payload");
  const overlappingClaim = await serviceRpc("claim_credential_sync_operation", {
    p_account_id: student.accountId,
    p_operation_kind: "student_password_recovery",
    p_lease_token_hash: "b".repeat(64),
  });
  assert.equal(overlappingClaim.ok, true);
  assert.deepEqual(await json(overlappingClaim), [], "an overlapping recovery request receives no active provider claim");
  const retryDuringLease = await postgrestRpc("force_password_change_for_account", {
    p_username: student.username,
    p_password_jwe: "c".repeat(64),
  }, verified.data.access_token);
  assert.equal(retryDuringLease.status, 200);
  assert.equal(await json(retryDuringLease), true, "a staff recovery retry does not create a second credential epoch");
  const stateDuringLease = await serviceRpc("resolve_account_identity", { p_account_id: student.accountId });
  assert.equal(stateDuringLease.ok, true);
  assert.equal((await json(stateDuringLease))[0].credential_epoch, recoveryState.credential_epoch);

  const revokedPriorSession = await api("/api/auth/session", { headers: { Cookie: oldCookie } });
  assert.deepEqual(await json(revokedPriorSession), { authenticated: false });
  const loginDuringRecovery = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": "192.0.2.72" },
    body: { username: student.username, password: student.password },
  });
  assert.equal(loginDuringRecovery.status, 401);
  assert.deepEqual(await json(loginDuringRecovery), { error: "invalid_credentials" });

  const racingCompletion = await serviceRpc("complete_password_change", {
    p_account_id: student.accountId,
    p_expected_credential_epoch: recoveryState.credential_epoch,
  });
  assert.equal(racingCompletion.ok, true);
  assert.equal(await json(racingCompletion), false, "a password change cannot clear a provider recovery in progress");

  const recoveryPassword = `Recovery-${crypto.randomUUID()}-Aa!`;
  const service = createClient(local.supabaseUrl, local.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const reset = await service.auth.admin.updateUserById(student.user.id, { password: recoveryPassword });
  assert.equal(reset.error, null, "the fictional local provider password is reset before finalization");

  const finalized = await serviceRpc("complete_student_password_recovery", {
    p_account_id: student.accountId,
    p_expected_credential_epoch: recoveryState.credential_epoch,
    p_lease_token_hash: leaseTokenHash,
  });
  assert.equal(finalized.ok, true);
  assert.equal(await json(finalized), true);

  const recoveryLogin = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": "192.0.2.73" },
    body: { username: student.username, password: recoveryPassword },
  });
  assert.equal(recoveryLogin.status, 200);
  const recoveryCookie = cookieFrom(recoveryLogin);
  const recoverySession = await json(recoveryLogin);
  assert.equal(recoverySession.user.mustChangePassword, true);

  const changedPassword = `RecoveryComplete-${crypto.randomUUID()}-Aa!`;
  const complete = await api("/api/auth/change-password", {
    method: "POST",
    origin,
    headers: { Cookie: recoveryCookie, "X-CSRF-Token": recoverySession.csrfToken },
    body: { oldPassword: recoveryPassword, newPassword: changedPassword },
  });
  assert.equal(complete.status, 200);
  assert.deepEqual(await json(complete), { changed: true, authenticated: false });

  const oldRecoveryCredential = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": "192.0.2.74" },
    body: { username: student.username, password: recoveryPassword },
  });
  assert.equal(oldRecoveryCredential.status, 401);
  const finalLogin = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": "192.0.2.75" },
    body: { username: student.username, password: changedPassword },
  });
  assert.equal(finalLogin.status, 200);

  const outsiderEmail = `fictional-${crypto.randomUUID()}@outside.invalid`;
  const outsider = await service.auth.admin.createUser({
    email: outsiderEmail,
    password: `Outside-${crypto.randomUUID()}-Aa!`,
    email_confirm: true,
  });
  assert.equal(outsider.error, null, "local Auth creates an unlinked reserved-domain fictional fixture");
  context.after(async () => {
    const deleted = await service.auth.admin.deleteUser(outsider.data.user.id);
    assert.equal(deleted.error, null, "reserved-domain unlinked provider fixture is removed");
  });
  const disallowedProvision = await postgrestRpc("provision_student_account", {
    p_provider_user_id: outsider.data.user.id,
    p_username: `outside.${crypto.randomUUID().slice(0, 8)}`,
    p_provider_email: outsiderEmail,
  }, verified.data.access_token);
  assert.equal(disallowedProvision.status, 400);
  assert.equal((await json(disallowedProvision)).code, "22023", "database rejects non-fictional identity domains even through direct PostgREST");
});
