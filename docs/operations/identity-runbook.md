# Identity operator runbook

Operator procedures for the Supabase project owner (the institution-approved
custodian). They use database-owner functions in `app_private`; no API role
(`anon`, `authenticated`, `service_role`) can execute them. Run them from the
Supabase dashboard SQL editor, which requires the owner's own dashboard login
and MFA. Every procedure writes an audit event.

These procedures do not authorize processing real identities. That still needs
the university approvals listed in `docs/roadmap.md`.

## 1. Bootstrap the first administrator

1. In the Supabase dashboard, Authentication → Users → Add user: enter the
   approved staff email and a strong temporary password. Do not enable sign-up.
2. Copy the new user's UUID, then run:

   ```sql
   select app_private.operator_bootstrap_initial_admin('<auth-user-uuid>', '<username>');
   ```

   The function refuses if any active administrator already exists, or if the
   user is banned or already has an MFA factor (someone else may have used the
   temporary password). It takes the email from `auth.users` (not from input),
   ends existing provider sessions, grants only `admin`, and forces a password
   change.
3. Give the temporary password to the administrator out of band. On first
   sign-in they must change the password, then enroll TOTP. Privileged actions
   require AAL2.

Further staff are created by this administrator through the application, not
by repeating the bootstrap.

## 2. Sole administrator (or any staff member) lost their TOTP factor

Normal path: a *different* AAL2 administrator uses MFA reset in the app.
Break-glass path, when no other AAL2 administrator exists:

1. Verify the person's identity through the institution-approved channel and
   record who approved it.
2. Run:

   ```sql
   select app_private.operator_recover_staff_mfa('<username>');
   ```

   This deletes the user's provider TOTP factors and provider sessions/refresh
   tokens, revokes all BFF sessions, cancels any pending credential sync, bumps
   the credential epoch, replaces the password with an unknown random value (it
   may have been lost with the device), and forces a password change.
3. Set a new temporary password for that user in the dashboard
   (Authentication → Users → the user) and deliver it out of band. They sign
   in, change the password, and re-enroll TOTP.

Before relying on these functions in a hosted project, verify on fictional
staging that the database owner can still modify `auth.mfa_factors`,
`auth.sessions`, and `auth.users` (Supabase may restrict the `auth` schema).
If not, use the dashboard / Auth Admin API to delete factors and set the
password, then run the function to update application state.

## 3. A recovery or MFA reset is stuck "sync pending"

Cause: the BFF did not get a definitive Auth Admin result (no response, timeout,
any 5xx, or the finalization write failed). Only a 4xx other than 408 counts as
a definitive rejection. The account stays blocked (fail-closed) and no new
credential generation can start while that provider request might still land.

- Within 15 minutes of the attempt: the staff action returns
  `recovery_applied_password_sync_pending` / `mfa_reset_sync_pending`. After a
  definitive rejection, a retry replays the same encrypted operation and
  succeeds; after an ambiguous failure the retry keeps reporting pending.
- After 15 minutes (the quiescence window): the administrator simply repeats
  the recovery or MFA reset in the app. The database then starts a new
  credential generation, discards the stale claim, and audits
  `account.credential_sync_reconciled`. No database access is needed.

Expired encrypted temporary passwords are pruned in bounded batches
(`prune_expired_credential_sync_operations`, 200 rows per call, run on each
login). A payload whose claim is still inside the quiescence window is kept
until that window passes, so a payload becomes prunable at most about 30
minutes after creation; it is removed by the next login after that.
