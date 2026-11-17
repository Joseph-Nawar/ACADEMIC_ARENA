# Identity operator runbook

Procedures for the Supabase project owner (the institution-approved
custodian). Provider-managed records (passwords, MFA factors, provider
sessions) are changed **only through the Supabase dashboard or the Auth Admin
API**. The owner-only SQL functions in `app_private` change application state
only (lockout, pending flags, credential epoch, audit). No API role (`anon`,
`authenticated`, `service_role`) can execute them. Run SQL from the dashboard
SQL editor, which requires the owner's own login and MFA.

Status: the SQL functions and the BFF behaviour are tested against the local
Supabase stack with fictional users only. Rehearse every procedure on a
fictional-data hosted staging project before use with real identities, which
also needs the university approvals in `docs/roadmap.md`.

Auth Admin API calls below use the project's service-role key from the
operator's own machine. Never paste it into a ticket, chat, or shell history,
and do not run these calls from shared hosts.

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
read -rs SERVICE_KEY
auth() { curl -sS -w '\nHTTP %{http_code}\n' -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" "$@"; }
```

## 1. Bootstrap the first administrator

1. Create the user: dashboard → Authentication → Users → Add user, with the
   approved staff email and a generated temporary password
   (`openssl rand -base64 24`). Public sign-up stays disabled.
2. Map it: `select app_private.operator_bootstrap_initial_admin('<auth-user-uuid>', '<username>');`
   It refuses if an active administrator exists, the user is banned, or the
   user already has an MFA factor. It reads the email from `auth.users`, grants
   only `admin`, and forces a password change.
3. Deliver the temporary password out of band. The administrator signs in,
   changes the password, and enrolls TOTP. If the app asks for a TOTP code
   instead of offering enrollment, stop: someone else enrolled a factor.

## 2. Staff member (including a sole administrator) lost their TOTP factor

The in-app MFA reset (a different AAL2 administrator) deletes factors and
forces a password change, but it does not issue a fresh password, so it does
not meet the fresh-password policy. Until it does, use this procedure for every
lost-factor case:

1. Verify identity through the institution-approved channel; record who
   approved it and the ticket reference.
2. Lock application state (blocks sign-in, revokes app sessions and erases
   their encrypted provider tokens, cancels any pending credential sync).
   Note the returned epoch:
   `select app_private.operator_lock_staff_for_mfa_recovery('<username>');`
3. Find the user's Auth ID (dashboard → Users, by email), then via Auth Admin:
   - List factors: `auth "$SUPABASE_URL/auth/v1/admin/users/<id>/factors"`
   - Delete each: `auth -X DELETE "$SUPABASE_URL/auth/v1/admin/users/<id>/factors/<factor-id>"`
   - Set a fresh password (always — the old one may be lost with the device):
     ```bash
     NEW_PASSWORD=$(openssl rand -base64 24)
     auth -X PUT "$SUPABASE_URL/auth/v1/admin/users/<id>" -d "{\"password\":\"$NEW_PASSWORD\"}"
     ```
   - Re-list factors and confirm the list is empty; confirm the PUT returned
     HTTP 200. If a call fails or times out, repeat it with the same values:
     deleting a factor ID and setting the same password are safe to repeat.
4. Finish: `select app_private.operator_finish_staff_mfa_recovery('<username>', <epoch>);`
   The forced password change stays set.
5. Deliver `NEW_PASSWORD` out of band, then `unset NEW_PASSWORD SERVICE_KEY`.
   The staff member signs in, changes the password, and enrolls a new TOTP
   factor.

Supabase Auth's Admin API has no call that revokes all of a user's provider
sessions. Provider refresh tokens are never sent to browsers (the BFF holds
them encrypted and step 2 erases them), but an already issued provider access
token stays valid until it expires (1 hour by default). It cannot pass
privileged database checks while the account is in forced-change state.

## 3. Recovery or MFA reset stuck "sync pending"

**Student password recovery.** The BFF keeps its claim held whenever the
password-update outcome is unknown: no response, timeout, any 5xx, or any 4xx
without one of Auth's pre-write error codes (`functions/lib/provider.js`).
Supabase Auth does not enforce our fencing token, and we have no provider-side
bound on when a delayed update could still apply. So the account stays blocked
(`recovery_applied_password_sync_pending` on every retry) until an operator
acts. Elapsed time alone never releases it.

1. Confirm the claim is held:
   ```sql
   select o.operation_kind, o.leased_at, o.expires_at, o.password_jwe is null as payload_erased
   from app_private.credential_sync_operations o
   join app_private.identity_mappings m on m.account_id = o.account_id
   where m.username_normalized = '<username>' and o.lease_token_hash is not null;
   ```
2. Release it: `select app_private.operator_release_stuck_credential_sync('<username>', 'student_password_recovery');`
   This deletes the operation, including its never-revealed encrypted
   temporary password, and keeps the account blocked.
3. A staff administrator runs recovery again in the app; it starts a new
   credential generation and shows a new temporary password.
4. Residual risk: the original update may still apply at some later time.
   Its password was never shown and is now destroyed, so the worst case is an
   account whose password nobody knows — the student's new temporary (or
   later self-chosen) password stops working. If that happens, staff simply run
   recovery again in the app (no claim is held any more, so no operator step
   is needed). No credential is disclosed. Optionally, before step 2, check the
   user's `updated_at` in the dashboard or the Auth audit logs to see whether
   the original update already applied; this is informative, not proof.

**Staff MFA reset.** The BFF releases its claim after any failure: listing
factors is a read, and each delete names one existing factor ID, so a delayed
delete can only remove a factor the reset is removing anyway (new factors get
new IDs). The administrator retries in the app. Use the release function with
`'staff_mfa_reset'` only if a claim is left held by a BFF crash.

## 4. Retention of encrypted temporary passwords

Cleanup is not on-request only: a `pg_cron` job
(`academic-arena-prune-credential-sync`, every minute; pg_cron is included in
Supabase Free) deletes expired unclaimed operations and erases the payload of
expired held ones, and each login runs the same cleanup (500 rows per step).
Operations expire 15 minutes after creation, so while the database runs and
there is no backlog beyond 500 rows a minute, a payload is erased within about
16 minutes. This is not a hard deletion guarantee: if the project is paused for
inactivity or the job fails, erasure waits until the database runs again, and erased bytes persist in Postgres
storage/WAL until vacuum and in any backup taken before erasure. Payloads are
JWE-encrypted with `SESSION_JWE_KEY`, which is never stored in the database.
A second job (`academic-arena-purge-cron-history`, daily) deletes pg_cron run
history older than two days. Check job health:
`select status, count(*) from cron.job_run_details group by status;`
