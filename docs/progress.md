# Progress notes

Keep short. Newest first.

## 2026-11-17 — M2 final review fixes (branch `m2/auth-database-foundation`, PR #3)

Review of M2 found and fixed:

- **Stuck claims were permanent.** A lost Auth Admin result left the lease held
  forever, blocking the account with no recovery path. Migration 009 stamps
  `leased_at`; after a 15-minute quiescence window an explicit staff retry
  starts a new generation (audited `account.credential_sync_reconciled`).
- **Ambiguous gateway statuses released claims.** Routes now release only on a
  definitive rejection (`providerResultIsDefinitive`: 4xx except 408). Timeouts
  and every 5xx keep the claim held.
- **Unbounded/incomplete cleanup.** Prune is limited to 200 rows per call and
  also removes expired payloads whose claim is stale.
- **No admin bootstrap or sole-admin MFA recovery.** Added database-owner-only
  `app_private.operator_bootstrap_initial_admin` and
  `app_private.operator_recover_staff_mfa`; runbook in
  `docs/operations/identity-runbook.md`. Break-glass also replaces the password
  with a random value; bootstrap refuses banned users or pre-enrolled factors.

Independent review (subagent) found no blockers; its medium findings are
fixed above. Its `has_permission` concern was already covered: it requires no
forced change or pending sync, which every reset sets. Not done (low): operator
audit rows have no actor column; hosted `auth` schema write rights unverified.

Reviewed without change: session resolution (AAL2 needs both the `aal2` claim
and a verified TOTP factor), CSRF/same-origin, SQL grants, forced RLS.

Deferred by design (gated, not launch-blocking for a fictional/read-only
release): lifecycle routes return 403 outside `ENVIRONMENT=test` and the DB
lifecycle gate defaults off; enabling them for real identities needs
university approval plus a hosted-integration review.

## Next

- M3: staff publishing (CSV validate/preview → versioned atomic publish,
  rollback), approved leaderboard API, Campus Wins templates/moderation/reactions.
- M4: Cloudflare + Supabase hosting, backups/restore, responsive/security QA,
  launch. Fictional-data staging only until approvals.
