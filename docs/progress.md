# Progress notes

Keep short. Newest first.

## 2026-11-17 — Hosted deployment (branch `m5/hosted-deployment`)

- **Deployed:** production https://academic-arena.pages.dev and staging https://academic-arena-staging.pages.dev. Each is a separate Pages project with its own 6 encrypted settings. Hosted checks are in `docs/operations/deployment-status.md`.
- **Fixed:** unknown `/api/*` paths returned the HTML shell with status 200; they now return a JSON 404.
- **Blocked:** this machine's network resets Postgres connections to the Supabase pooler, so `db push` fails. `scripts/hosted-sql.mjs` applies migrations over HTTPS instead, but needs the owner's keychain approval. Until then both sites fail closed ("temporarily unavailable").
- **Owner checklist (in order):**
  1. In Terminal in this repo, run `node scripts/hosted-sql.mjs cynfnxlbmthjxgivllkg migrate`. Allow the keychain prompt. Expect 10 "applied" lines.
  2. Check staging: `node scripts/hosted-sql.mjs cynfnxlbmthjxgivllkg query "select count(*) from supabase_migrations.schema_migrations"` should return 10. Then open https://academic-arena-staging.pages.dev; the empty state should read "No cohorts are available…".
  3. Repeat steps 1–2 with `jhukafyrdredfkzyzggw` (production).
  4. Staging admin: in the dashboard, Auth → Add user. Use a mailbox you control, with a generated password and auto-confirm. Then in the SQL editor run `select app_private.operator_bootstrap_initial_admin('<uuid>','<username>');`.
  5. Sign in at staging, change the password, and enroll TOTP. Then upload `data/ranking-upload.example.csv`, publish, roll back, and withdraw. Leave staging withdrawn afterwards so fictional names are not left public.
  6. Repeat step 4 on production only with an identity the university approves for external processing.

## 2026-11-17 — M3 merged, M4 in progress

- **M3** merged as PR #4 (`eb526df`). The migration is `202611170001_m3_publication_and_campus_wins.sql`. The independent review found no blockers; its medium/low findings were fixed: deadlock-safe locking, formula-prefix label checks, no self-reactions, CSV headroom.
- Known V1 limits:
  - One active draft at a time; each upload replaces the previous unpublished draft.
  - Suspending a student does not hide their published posts.
  - Reactions are not rate-limited beyond authentication.
- **M4** (branch `m4/ops-and-deploy`):
  - `scripts/db-backup.sh` does encrypted export/restore; the local drill passed (see `docs/operations/backup-restore.md`).
  - `scripts/configure-pages-secrets.sh` loads provider secrets without printing them.
  - Runbooks: `docs/operations/deployment.md` and `docs/operations/staff-guide.md`.
- **Blocked on the owner:** `npx supabase login`, `npx wrangler login`, and two Supabase Free projects (staging, prod) with sign-up disabled. Then follow `deployment.md`.
- **Hosted release plan:**
  - Production shows the public site with the empty "no approved standings" state, plus staff publishing for a bootstrapped admin.
  - Student accounts and Campus Wins submissions are unavailable on hosted until account provisioning is verified and the university approves real identities.
  - No fictional rankings are ever published to production.
- `scripts/local-live-preview.mjs` runs the production build against local Supabase with fictional accounts, for manual QA.

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
