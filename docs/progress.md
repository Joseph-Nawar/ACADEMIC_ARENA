# Progress notes

Keep short. Newest first.

## 2026-11-17 — M2 owner-review corrections (branch `m2/auth-database-foundation`, PR #3)

The owner rejected `a5aa236`. Migration 009 was rewritten (never merged or
hosted) as follows:

- **No time-based reconciliation.** Held password-update claims never expire.
  Auth does not enforce our fencing token, so elapsed time proves nothing.
  `app_private.operator_release_stuck_credential_sync` (owner-only) releases
  the claim explicitly and destroys the never-revealed payload; staff then
  start a fresh recovery.
- **No writes to `auth.*`.** Break-glass is now `operator_lock_staff_for_mfa_recovery`
  and `operator_finish_staff_mfa_recovery`, which change application tables only.
  Factor deletion and the mandatory fresh password go through the Auth Admin
  API (see runbook). Bootstrap only reads `auth.users` and `auth.mfa_factors`.
- **Per-operation release rules.** A password update is released only for Auth's
  pre-write error codes (`passwordUpdateRejectedBeforeWrite`). An MFA reset is
  released after any failure: listing is a read, and each delete is scoped to
  one factor ID.
- **Retention.** pg_cron runs every minute (Supabase Free) and login also
  prunes. Expired payloads, including those of held claims, are erased. This
  is not a guarantee while a project is paused.

Fresh independent review: no blockers, safe as a development foundation.
Fixed from it: finish now requires staff role plus the lock step's audit
marker; cron history purge; doc contradictions; weak test assertions; a new
late-stale-write integration test. **Open:** the in-app staff MFA reset does
not issue a fresh password, so it must stay disabled for hosted identities
(use the runbook break-glass for every lost-factor case).

## 2026-11-17 — M2 final review fixes (superseded above)

`a5aa236` added a 15-minute quiescence reconciliation and direct `auth.*`
break-glass writes; both were replaced by the corrections above.

Reviewed without change: session resolution (AAL2 needs both the `aal2` claim
and a verified TOTP factor), CSRF/same-origin, SQL grants, forced RLS.

Deferred by design: lifecycle routes return 403 outside `ENVIRONMENT=test` and
the DB lifecycle gate defaults off; enabling them for real identities needs
university approval plus hosted fictional-staging verification.

## Next

- M3: staff publishing (CSV validate/preview → versioned atomic publish,
  rollback), approved leaderboard API, Campus Wins templates/moderation/reactions.
- M4: Cloudflare + Supabase hosting, backups/restore, responsive/security QA,
  launch. Fictional-data staging only until approvals.
