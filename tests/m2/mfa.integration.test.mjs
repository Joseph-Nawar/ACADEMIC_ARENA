import assert from "node:assert/strict";
import test from "node:test";
import * as OTPAuth from "otpauth";
import {
  api,
  cleanupProvisionedIdentity,
  createIdentity,
  injectProviderFailure,
  json,
  local,
  operatorReleaseStuckCredentialSync,
  pauseNextProviderRequest,
  providerRequestState,
  releaseProviderRequest,
  serviceRpc,
  setFictionalAccountRole,
} from "./bff-fixtures.mjs";

const origin = new URL(local.pagesUrl).origin;

function cookieFrom(response) {
  const value = (response.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(value, /^__Host-aa_session=[A-Za-z0-9_-]{43}$/u);
  return value;
}

function staffIdentity(context, label) {
  return createIdentity(context, label).then((identity) => {
    setFictionalAccountRole(identity.accountId, "admin");
    return identity;
  });
}

function staffHeaders(cookie, csrfToken) {
  return { Cookie: cookie, "X-CSRF-Token": csrfToken };
}

async function loginStaff(identity, clientIp) {
  const response = await api("/api/auth/login", {
    method: "POST",
    origin,
    headers: { "CF-Connecting-IP": clientIp },
    body: { username: identity.username, password: identity.password },
  });
  return { response, cookie: cookieFrom(response), payload: await json(response) };
}

async function makeCode(secret) {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  return totp.generate();
}

async function enrollStaffFactor(identity, clientIp) {
  const session = await loginStaff(identity, clientIp);
  assert.equal(session.response.status, 200);
  const enrollment = await api("/api/auth/mfa/enroll", {
    method: "POST",
    origin,
    headers: staffHeaders(session.cookie, session.payload.csrfToken),
    body: {},
  });
  assert.equal(enrollment.status, 200);
  const { secret } = await json(enrollment);
  const verify = await api("/api/auth/mfa/verify", {
    method: "POST",
    origin,
    headers: staffHeaders(session.cookie, session.payload.csrfToken),
    body: { code: await makeCode(secret) },
  });
  assert.equal(verify.status, 200, JSON.stringify(await json(verify)));
  return session;
}

test("staff TOTP enrollment, login step-up, and privileged account provisioning use actual Supabase Auth", async (context) => {
  const identity = await staffIdentity(context, "mfa-admin");
  const firstLogin = await loginStaff(identity, "192.0.2.40");
  assert.equal(firstLogin.response.status, 200);
  assert.equal(firstLogin.payload.user.mfaRequired, true);
  assert.equal(firstLogin.payload.user.mfaSetupRequired, true);
  assert.equal(firstLogin.payload.user.role, "admin");
  assert.equal(firstLogin.payload.user.mustChangePassword, false);
  for (const value of [identity.email, identity.providerSession.access_token, identity.providerSession.refresh_token, local.serviceRoleKey]) {
    assert.equal(JSON.stringify(firstLogin.payload).includes(value), false);
  }

  const denied = await api("/api/staff/accounts", {
    method: "POST",
    origin,
    headers: staffHeaders(firstLogin.cookie, firstLogin.payload.csrfToken),
    body: { username: "fictional.student", email: "fictional.student@academic-arena.test" },
  });
  assert.equal(denied.status, 403, "AAL1 staff sessions cannot perform privileged operations");

  const enrollment = await api("/api/auth/mfa/enroll", {
    method: "POST",
    origin,
    headers: staffHeaders(firstLogin.cookie, firstLogin.payload.csrfToken),
    body: {},
  });
  assert.equal(enrollment.status, 200);
  assert.match(enrollment.headers.get("cache-control") || "", /no-store/u);
  const enrollmentPayload = await json(enrollment);
  assert.deepEqual(Object.keys(enrollmentPayload), ["secret"]);
  assert.equal(JSON.stringify(enrollmentPayload).includes(identity.email), false, "TOTP response does not disclose the provider email");
  assert.ok(enrollmentPayload.secret.length >= 16);

  const invalidCode = await api("/api/auth/mfa/verify", {
    method: "POST",
    origin,
    headers: staffHeaders(firstLogin.cookie, firstLogin.payload.csrfToken),
    body: { code: "000000" },
  });
  assert.equal(invalidCode.status, 400);
  assert.deepEqual(await json(invalidCode), { error: "mfa_verification_failed" });

  const enrollmentCode = await makeCode(enrollmentPayload.secret);
  const enrollmentVerification = await api("/api/auth/mfa/verify", {
    method: "POST",
    origin,
    headers: staffHeaders(firstLogin.cookie, firstLogin.payload.csrfToken),
    body: { code: enrollmentCode },
  });
  const enrollmentVerificationPayload = await json(enrollmentVerification);
  assert.equal(enrollmentVerification.status, 200, JSON.stringify(enrollmentVerificationPayload));
  assert.deepEqual(enrollmentVerificationPayload, {
    authenticated: true,
    user: { role: "admin", mustChangePassword: false, mfaRequired: false, mfaSetupRequired: false },
  });

  const firstAal2 = await api("/api/auth/session", { headers: { Cookie: firstLogin.cookie } });
  assert.deepEqual(await json(firstAal2), {
    authenticated: true,
    user: { role: "admin", mustChangePassword: false, mfaRequired: false, mfaSetupRequired: false },
    csrfToken: firstLogin.payload.csrfToken,
  });

  const logout = await api("/api/auth/logout", {
    method: "POST",
    origin,
    headers: staffHeaders(firstLogin.cookie, firstLogin.payload.csrfToken),
  });
  assert.equal(logout.status, 204);

  const secondLogin = await loginStaff(identity, "192.0.2.41");
  assert.equal(secondLogin.response.status, 200);
  assert.equal(secondLogin.payload.user.mfaRequired, true);
  assert.equal(secondLogin.payload.user.mfaSetupRequired, false);
  const code = await makeCode(enrollmentPayload.secret);
  const secondFactor = await api("/api/auth/mfa/verify", {
    method: "POST",
    origin,
    headers: staffHeaders(secondLogin.cookie, secondLogin.payload.csrfToken),
    body: { code },
  });
  assert.equal(secondFactor.status, 200);
  assert.deepEqual(await json(secondFactor), {
    authenticated: true,
    user: { role: "admin", mustChangePassword: false, mfaRequired: false, mfaSetupRequired: false },
  });

  const create = await api("/api/staff/accounts", {
    method: "POST",
    origin,
    headers: staffHeaders(secondLogin.cookie, secondLogin.payload.csrfToken),
    body: { username: "mfa.provisioned", email: `provisioned-${crypto.randomUUID()}@academic-arena.test` },
  });
  assert.equal(create.status, 201);
  const provisioned = await json(create);
  assert.deepEqual(Object.keys(provisioned).sort(), ["created", "initialPassword", "username"].sort());
  assert.equal(provisioned.created, true);
  assert.equal(provisioned.username, "mfa.provisioned");
  assert.ok(provisioned.initialPassword.length >= 43);
  for (const value of [identity.email, identity.providerSession.access_token, identity.providerSession.refresh_token, local.serviceRoleKey]) {
    assert.equal(JSON.stringify(provisioned).includes(value), false);
  }

  const provisionedIdentity = await cleanupProvisionedIdentity(context, provisioned.username);
  const initialStudentLogin = await api("/api/auth/login", {
    method: "POST", origin,
    headers: { "CF-Connecting-IP": "192.0.2.47" },
    body: { username: provisioned.username, password: provisioned.initialPassword },
  });
  assert.equal(initialStudentLogin.status, 200);
  const initialStudentSession = cookieFrom(initialStudentLogin);
  const initialStudentPayload = await json(initialStudentLogin);
  assert.deepEqual(initialStudentPayload.user, { role: "student", mustChangePassword: true });
  const firstStudentPassword = `ChangedOne-${crypto.randomUUID()}-A!`;
  const firstPasswordChange = await api("/api/auth/change-password", {
    method: "POST", origin,
    headers: staffHeaders(initialStudentSession, initialStudentPayload.csrfToken),
    body: { oldPassword: provisioned.initialPassword, newPassword: firstStudentPassword },
  });
  assert.equal(firstPasswordChange.status, 200);
  // V1.6: a student is signed straight back in with the new password.
  const firstPasswordChangeBody = await json(firstPasswordChange);
  assert.equal(firstPasswordChangeBody.changed, true);
  assert.equal(firstPasswordChangeBody.authenticated, true);
  assert.deepEqual(firstPasswordChangeBody.user, { role: "student", mustChangePassword: false });
  assert.deepEqual(await json(await api("/api/auth/session", { headers: { Cookie: initialStudentSession } })), { authenticated: false });

  const oldCredential = await api("/api/auth/login", {
    method: "POST", origin,
    headers: { "CF-Connecting-IP": "192.0.2.48" },
    body: { username: provisioned.username, password: provisioned.initialPassword },
  });
  assert.equal(oldCredential.status, 401);
  assert.deepEqual(await json(oldCredential), { error: "invalid_credentials" });

  const activeStudentLogin = await api("/api/auth/login", {
    method: "POST", origin,
    headers: { "CF-Connecting-IP": "192.0.2.49" },
    body: { username: provisioned.username, password: firstStudentPassword },
  });
  assert.equal(activeStudentLogin.status, 200);
  const activeStudentCookie = cookieFrom(activeStudentLogin);
  const activeStudentPayload = await json(activeStudentLogin);
  assert.equal(activeStudentPayload.user.mustChangePassword, false);

  await injectProviderFailure(provisionedIdentity.provider_user_id, "user-password-update");
  const interruptedRecovery = await api("/api/staff/accounts/recovery", {
    method: "POST", origin,
    headers: staffHeaders(secondLogin.cookie, secondLogin.payload.csrfToken),
    body: { username: provisioned.username },
  });
  assert.equal(interruptedRecovery.status, 503, "a temporary Auth Admin error keeps recovery pending");
  assert.deepEqual(await json(interruptedRecovery), { error: "recovery_applied_password_sync_pending" });
  const recoveryIdentity = await serviceRpc("resolve_account_identity", { p_account_id: provisionedIdentity.account_id });
  assert.equal(recoveryIdentity.ok, true);
  assert.equal((await json(recoveryIdentity))[0].credential_update_pending, true,
    "the account remains blocked after the injected provider failure");

  const recovery = await api("/api/staff/accounts/recovery", {
    method: "POST", origin,
    headers: staffHeaders(secondLogin.cookie, secondLogin.payload.csrfToken),
    body: { username: provisioned.username },
  });
  assert.equal(recovery.status, 200);
  const recoveryPayload = await json(recovery);
  assert.deepEqual(Object.keys(recoveryPayload).sort(), ["initialPassword", "recovered", "username"].sort());
  assert.equal(recoveryPayload.recovered, true);
  assert.equal(recoveryPayload.initialPassword.length >= 43, true);
  for (const value of [provisionedIdentity.provider_email, local.serviceRoleKey]) {
    assert.equal(JSON.stringify(recoveryPayload).includes(value), false);
  }
  assert.deepEqual(await json(await api("/api/auth/session", { headers: { Cookie: activeStudentCookie } })), { authenticated: false });

  const recoveredLogin = await api("/api/auth/login", {
    method: "POST", origin,
    headers: { "CF-Connecting-IP": "192.0.2.50" },
    body: { username: provisioned.username, password: recoveryPayload.initialPassword },
  });
  assert.equal(recoveredLogin.status, 200);
  const recoveredCookie = cookieFrom(recoveredLogin);
  const recoveredSession = await json(recoveredLogin);
  assert.equal(recoveredSession.user.mustChangePassword, true);
  const secondStudentPassword = `ChangedTwo-${crypto.randomUUID()}-B!`;
  const secondPasswordChange = await api("/api/auth/change-password", {
    method: "POST", origin,
    headers: staffHeaders(recoveredCookie, recoveredSession.csrfToken),
    body: { oldPassword: recoveryPayload.initialPassword, newPassword: secondStudentPassword },
  });
  assert.equal(secondPasswordChange.status, 200);

  const suspension = await api("/api/staff/accounts/suspend", {
    method: "POST", origin,
    headers: staffHeaders(secondLogin.cookie, secondLogin.payload.csrfToken),
    body: { username: provisioned.username },
  });
  assert.equal(suspension.status, 200);
  assert.deepEqual(await json(suspension), { suspended: true });
  assert.deepEqual(await json(await api("/api/auth/session", { headers: { Cookie: recoveredCookie } })), { authenticated: false });
  const suspendedLogin = await api("/api/auth/login", {
    method: "POST", origin,
    headers: { "CF-Connecting-IP": "192.0.2.51" },
    body: { username: provisioned.username, password: secondStudentPassword },
  });
  assert.equal(suspendedLogin.status, 401);
  assert.deepEqual(await json(suspendedLogin), { error: "invalid_credentials" });
  assert.equal(provisionedIdentity.account_status, "active");
});

test("staff MFA enrollment and verification enforce exact Origin, CSRF, and code shape", async (context) => {
  const identity = await staffIdentity(context, "mfa-origin-admin");
  const session = await loginStaff(identity, "192.0.2.42");
  assert.equal(session.response.status, 200);

  for (const [path, body] of [
    ["/api/auth/mfa/enroll", {}],
    ["/api/auth/mfa/verify", { code: "123456" }],
  ]) {
    const noOrigin = await api(path, {
      method: "POST",
      headers: staffHeaders(session.cookie, session.payload.csrfToken),
      body,
    });
    assert.equal(noOrigin.status, 403);
    const noCsrf = await api(path, {
      method: "POST",
      origin,
      headers: { Cookie: session.cookie },
      body,
    });
    assert.equal(noCsrf.status, 403);
  }

  const malformed = await api("/api/auth/mfa/verify", {
    method: "POST",
    origin,
    headers: staffHeaders(session.cookie, session.payload.csrfToken),
    body: { code: "12345", factorId: "attacker-selected-factor" },
  });
  assert.equal(malformed.status, 400);
});

test("persistent MFA verification limits reject concurrent guessing attempts", async (context) => {
  const identity = await staffIdentity(context, "mfa-rate-admin");
  const session = await loginStaff(identity, "192.0.2.43");
  assert.equal(session.response.status, 200);
  const attempts = await Promise.all(Array.from({ length: 7 }, () => api("/api/auth/mfa/verify", {
    method: "POST",
    origin,
    headers: staffHeaders(session.cookie, session.payload.csrfToken),
    body: { code: "123456" },
  })));
  for (const response of attempts) {
    assert.equal(response.status, 400);
    assert.deepEqual(await json(response), { error: "mfa_verification_failed" });
  }
  const limited = await api("/api/auth/mfa/verify", {
    method: "POST",
    origin,
    headers: staffHeaders(session.cookie, session.payload.csrfToken),
    body: { code: "123456" },
  });
  assert.equal(limited.status, 429);
  assert.deepEqual(await json(limited), { error: "mfa_verification_failed" });
});

test("AAL2 administrator can recover another staff MFA and revoke that account's BFF sessions", async (context) => {
  const administrator = await staffIdentity(context, "mfa-reset-admin");
  const adminSession = await enrollStaffFactor(administrator, "192.0.2.44");
  const target = await staffIdentity(context, "mfa-reset-target");
  const targetSession = await enrollStaffFactor(target, "192.0.2.45");

  await injectProviderFailure(target.user.id, "mfa-factor-list");
  const interruptedReset = await api("/api/staff/accounts/mfa-reset", {
    method: "POST",
    origin,
    headers: staffHeaders(adminSession.cookie, adminSession.payload.csrfToken),
    body: { username: target.username },
  });
  assert.equal(interruptedReset.status, 503, "a temporary Auth Admin error leaves staff MFA reset pending");
  assert.deepEqual(await json(interruptedReset), { error: "mfa_reset_sync_pending" });
  const targetIdentity = await serviceRpc("resolve_account_identity", { p_account_id: target.accountId });
  assert.equal(targetIdentity.ok, true);
  assert.equal((await json(targetIdentity))[0].credential_update_pending, true,
    "staff login stays blocked after the injected provider failure");

  const reset = await api("/api/staff/accounts/mfa-reset", {
    method: "POST",
    origin,
    headers: staffHeaders(adminSession.cookie, adminSession.payload.csrfToken),
    body: { username: target.username },
  });
  const resetPayload = await json(reset);
  assert.equal(reset.status, 200, JSON.stringify(resetPayload));
  assert.deepEqual(resetPayload, { mfaReset: true, username: target.username });
  const retriedReset = await api("/api/staff/accounts/mfa-reset", {
    method: "POST",
    origin,
    headers: staffHeaders(adminSession.cookie, adminSession.payload.csrfToken),
    body: { username: target.username },
  });
  assert.equal(retriedReset.status, 200);
  assert.deepEqual(await json(retriedReset), resetPayload, "a retry safely repeats provider factor removal");

  const oldSession = await api("/api/auth/session", { headers: { Cookie: targetSession.cookie } });
  assert.deepEqual(await json(oldSession), { authenticated: false });

  const nextLogin = await loginStaff(target, "192.0.2.46");
  assert.equal(nextLogin.response.status, 200);
  assert.equal(nextLogin.payload.user.mustChangePassword, true);
  assert.equal(nextLogin.payload.user.mfaRequired, true);
  assert.equal(nextLogin.payload.user.mfaSetupRequired, true);
  for (const value of [target.email, target.providerSession.access_token, target.providerSession.refresh_token, local.serviceRoleKey]) {
    assert.equal(JSON.stringify(nextLogin.payload).includes(value), false);
  }
});

test("a delayed provider password request blocks overlapping recovery and a newer credential generation", async (context) => {
  const administrator = await staffIdentity(context, "recovery-lease-admin");
  const adminSession = await enrollStaffFactor(administrator, "192.0.2.80");
  const student = await createIdentity(context, "recovery-lease-student");
  await pauseNextProviderRequest(student.user.id, "user-password-update");

  const firstRequest = api("/api/staff/accounts/recovery", {
    method: "POST",
    origin,
    headers: staffHeaders(adminSession.cookie, adminSession.payload.csrfToken),
    body: { username: student.username },
  });
  let firstResponse;
  let paused = false;
  let failure;
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const state = await providerRequestState(student.user.id, "user-password-update");
      if (state.paused) {
        paused = true;
        assert.equal(state.count, 1, "only one provider password update entered the paused proxy");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(paused, true, "the first BFF request reaches the deliberately paused local Auth Admin request");

    const overlap = await api("/api/staff/accounts/recovery", {
      method: "POST",
      origin,
      headers: staffHeaders(adminSession.cookie, adminSession.payload.csrfToken),
      body: { username: student.username },
    });
    assert.equal(overlap.status, 503, "the second BFF request cannot enter Auth Admin while the first owns the lease");
    assert.equal(overlap.headers.get("retry-after"), null,
      "the BFF does not promise automatic recovery from an ambiguous provider operation");
    assert.deepEqual(await json(overlap), { error: "recovery_applied_password_sync_pending" });
    const state = await providerRequestState(student.user.id, "user-password-update");
    assert.equal(state.count, 1, "the provider saw exactly one request for the active recovery generation");
    assert.equal(state.paused, true);

    const accountResponse = await serviceRpc("resolve_account_identity", { p_account_id: student.accountId });
    assert.equal(accountResponse.ok, true);
    const accountRows = await json(accountResponse);
    assert.equal(accountRows[0].credential_epoch, 1, "overlap cannot create a newer credential generation");
    assert.equal(accountRows[0].credential_update_pending, true);
  } catch (error) {
    failure = error;
  } finally {
    if (paused) await releaseProviderRequest(student.user.id, "user-password-update");
    firstResponse = await firstRequest;
  }
  if (failure) throw failure;

  assert.equal(firstResponse.status, 200, JSON.stringify(await json(firstResponse)));
  assert.equal((await providerRequestState(student.user.id, "user-password-update")).count, 1);

  const nextGeneration = await api("/api/staff/accounts/recovery", {
    method: "POST",
    origin,
    headers: staffHeaders(adminSession.cookie, adminSession.payload.csrfToken),
    body: { username: student.username },
  });
  assert.equal(nextGeneration.status, 200, JSON.stringify(await json(nextGeneration)));
  assert.equal((await providerRequestState(student.user.id, "user-password-update")).count, 2,
    "a new generation reaches Auth Admin only after the leased generation completes");
  const accountResponse = await serviceRpc("resolve_account_identity", { p_account_id: student.accountId });
  assert.equal(accountResponse.ok, true);
  assert.equal((await json(accountResponse))[0].credential_epoch, 2);
});

test("an Auth Admin request that outlives the BFF timeout cannot be reclaimed or overtaken", async (context) => {
  const administrator = await staffIdentity(context, "recovery-timeout-admin");
  const adminSession = await enrollStaffFactor(administrator, "192.0.2.81");
  const student = await createIdentity(context, "timeout-student");
  await pauseNextProviderRequest(student.user.id, "user-password-update");

  const firstRequest = api("/api/staff/accounts/recovery", {
    method: "POST",
    origin,
    headers: staffHeaders(adminSession.cookie, adminSession.payload.csrfToken),
    body: { username: student.username },
  });
  let firstResponse;
  let paused = false;
  let failure;
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const state = await providerRequestState(student.user.id, "user-password-update");
      if (state.paused) {
        paused = true;
        assert.equal(state.count, 1);
        assert.equal(state.completedCount, 0);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(paused, true, "the provider request is held in the loopback proxy");

    firstResponse = await firstRequest;
    assert.equal(firstResponse.status, 503, "the BFF's 15-second provider timeout fails closed");
    assert.deepEqual(await json(firstResponse), { error: "recovery_applied_password_sync_pending" });
    let state = await providerRequestState(student.user.id, "user-password-update");
    assert.equal(state.paused, true, "downstream work remains queued after the BFF timed out");
    assert.equal(state.completedCount, 0);

    const overlap = await api("/api/staff/accounts/recovery", {
      method: "POST",
      origin,
      headers: staffHeaders(adminSession.cookie, adminSession.payload.csrfToken),
      body: { username: student.username },
    });
    assert.equal(overlap.status, 503, "a second request cannot steal a non-expiring provider claim");
    assert.equal(overlap.headers.get("retry-after"), null, "the BFF does not promise automatic lease expiry");
    state = await providerRequestState(student.user.id, "user-password-update");
    assert.equal(state.count, 1, "the overlapping request does not enter Auth Admin");

    const accountResponse = await serviceRpc("resolve_account_identity", { p_account_id: student.accountId });
    assert.equal(accountResponse.ok, true);
    const accountRows = await json(accountResponse);
    assert.equal(accountRows[0].credential_epoch, 1);
    assert.equal(accountRows[0].credential_update_pending, true);
  } catch (error) {
    failure = error;
  } finally {
    if (paused) await releaseProviderRequest(student.user.id, "user-password-update");
    if (!firstResponse) firstResponse = await firstRequest;
  }
  if (failure) throw failure;

  let state;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    state = await providerRequestState(student.user.id, "user-password-update");
    if (state.completedCount === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(state.completedCount, 1, "the delayed upstream password update completed after the BFF response timed out");

  const stillBlocked = await api("/api/staff/accounts/recovery", {
    method: "POST",
    origin,
    headers: staffHeaders(adminSession.cookie, adminSession.payload.csrfToken),
    body: { username: student.username },
  });
  assert.equal(stillBlocked.status, 503, "a later credential generation remains blocked after the stale provider write completes");
  const accountResponse = await serviceRpc("resolve_account_identity", { p_account_id: student.accountId });
  assert.equal(accountResponse.ok, true);
  const accountRows = await json(accountResponse);
  assert.equal(accountRows[0].credential_epoch, 1, "no new credential epoch can overtake an uncertain provider request");
  assert.equal(accountRows[0].credential_update_pending, true);

  const claimAttempt = await serviceRpc("claim_credential_sync_operation", {
    p_account_id: student.accountId,
    p_operation_kind: "student_password_recovery",
    p_lease_token_hash: "e".repeat(64),
  });
  assert.equal(claimAttempt.ok, true);
  assert.deepEqual(await json(claimAttempt), [], "only explicit provider reconciliation can release the timed-out claim");
});

test("an ambiguous password-update failure stays fail-closed until an explicit operator release", async (context) => {
  const administrator = await staffIdentity(context, "ambiguous-admin");
  const adminSession = await enrollStaffFactor(administrator, "198.51.100.61");
  const student = await createIdentity(context, "ambiguous-student");
  const recover = () => api("/api/staff/accounts/recovery", {
    method: "POST",
    origin,
    headers: staffHeaders(adminSession.cookie, adminSession.payload.csrfToken),
    body: { username: student.username },
  });

  await injectProviderFailure(student.user.id, "user-password-update-ambiguous");
  const interrupted = await recover();
  assert.equal(interrupted.status, 503);
  assert.deepEqual(await json(interrupted), { error: "recovery_applied_password_sync_pending" });

  const retried = await recover();
  assert.equal(retried.status, 503, "a gateway timeout keeps the provider claim held; a retry cannot re-enter Auth Admin");
  assert.deepEqual(await json(retried), { error: "recovery_applied_password_sync_pending" });
  const blockedIdentity = await serviceRpc("resolve_account_identity", { p_account_id: student.accountId });
  assert.equal((await json(blockedIdentity))[0].credential_update_pending, true, "the student stays blocked");
  const blockedLogin = await api("/api/auth/login", {
    method: "POST", origin,
    headers: { "CF-Connecting-IP": "198.51.100.62" },
    body: { username: student.username, password: student.password },
  });
  assert.equal(blockedLogin.status, 401, "sign-in stays blocked while the outcome is unknown");

  operatorReleaseStuckCredentialSync(student.username, "student_password_recovery");
  const recovered = await recover();
  assert.equal(recovered.status, 200, "after the operator release, staff can start a fresh recovery");
  const payload = await json(recovered);
  assert.equal(payload.recovered, true);
  const freshLogin = await api("/api/auth/login", {
    method: "POST", origin,
    headers: { "CF-Connecting-IP": "198.51.100.63" },
    body: { username: student.username, password: payload.initialPassword },
  });
  assert.equal(freshLogin.status, 200);
  assert.deepEqual((await json(freshLogin)).user, { role: "student", mustChangePassword: true });
});

test("a stale password write landing after operator release only locks the account and recovery still works", async (context) => {
  const administrator = await staffIdentity(context, "late-write-admin");
  const adminSession = await enrollStaffFactor(administrator, "198.51.100.71");
  const student = await createIdentity(context, "late-write-student");
  const recover = () => api("/api/staff/accounts/recovery", {
    method: "POST",
    origin,
    headers: staffHeaders(adminSession.cookie, adminSession.payload.csrfToken),
    body: { username: student.username },
  });
  const login = (password, ip) => api("/api/auth/login", {
    method: "POST", origin,
    headers: { "CF-Connecting-IP": ip },
    body: { username: student.username, password },
  });

  await pauseNextProviderRequest(student.user.id, "user-password-update");
  const staleRequest = recover();
  let paused = false;
  try {
    for (let attempt = 0; attempt < 120 && !paused; attempt += 1) {
      paused = (await providerRequestState(student.user.id, "user-password-update")).paused;
      if (!paused) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(paused, true, "the original provider password update is held in the loopback proxy");
    const staleResponse = await staleRequest;
    assert.equal(staleResponse.status, 503, "the BFF times out and fails closed");

    operatorReleaseStuckCredentialSync(student.username, "student_password_recovery");
    const fresh = await recover();
    assert.equal(fresh.status, 200, "staff start a fresh generation after the explicit release");
    const freshPassword = (await json(fresh)).initialPassword;
    assert.equal((await login(freshPassword, "198.51.100.72")).status, 200);

    const before = await providerRequestState(student.user.id, "user-password-update");
    assert.equal(before.paused, true, "the stale write is still held while the fresh recovery completes");
    await releaseProviderRequest(student.user.id, "user-password-update");
    paused = false;
    let state;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      state = await providerRequestState(student.user.id, "user-password-update");
      if (state.completedCount > before.completedCount) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(state.completedCount > before.completedCount, "the stale provider write lands after the fresh recovery");
    assert.equal((await login(freshPassword, "198.51.100.73")).status, 401,
      "documented residual risk: the stale write leaves a password nobody was shown");
  } finally {
    if (paused) await releaseProviderRequest(student.user.id, "user-password-update");
    await staleRequest.catch(() => undefined);
  }

  const again = await recover();
  assert.equal(again.status, 200, "an ordinary recovery restores access; no operator step is needed");
  assert.equal((await login((await json(again)).initialPassword, "198.51.100.74")).status, 200);
});
