# Progress notes

Keep short. Newest first.

## 2026-11-18 — V1.2 Phase A: short names, single header

- The leaderboard shows first + final name component (`assets/display-names.js`). Names that collide within a level expand with middle components until unique; the full approved name stays as the tooltip and accessible text. No data or CSV change.
- Podium tags wrap to at most two lines. The duplicate `.eue-identity-bar` is removed; EUE stays in the sidebar brand area. On mobile there is one dark nav row plus a thin account row.
- Production Week 5 boards: 10 unique short names per level, none longer than 19 characters.

## 2026-11-18 — Hosted acceptance complete (PR #9)

- Both databases are migrated (11 migrations) with lifecycle gates off.
- The staging admin is onboarded. The fictional publish, rollback and withdraw workflow passed on staging, and staging was left withdrawn.
- Production is empty, with no admin yet. See `docs/operations/deployment-status.md`.
- **Remaining steps for official publication:**
  1. **Production admin.** In the Supabase dashboard for `academic-arena-prod`, go to Auth → Add user. Use a staff identity approved for processing in Supabase, a generated password, and auto-confirm. Then run `select app_private.operator_bootstrap_initial_admin('<uuid>','<username>');` in the SQL editor.
  2. Sign in at https://academic-arena.pages.dev, change the password, and enroll TOTP.
  3. **After written university approval** for those specific names and ranks: open Staff Desk, enter year `2026-27` and label `Week 5`, choose the private CSV, then Validate & preview → check every level → Publish.
  4. Check all three levels on the public site. If anything is wrong, use Withdraw or Roll back.
  5. Take an encrypted backup (`backup-restore.md`).

## 2026-11-18 — V1 level-only release (PR #7, `b5921df`)

- Added migration `202611180001_level_only_leaderboards.sql`, append-only:
  - a `published_level_rows` table holding only snapshot, level, position and name;
  - `board_format` and `release_label` columns on snapshots;
  - level-only draft, publish, rows and history RPCs. These reuse AAL2, the
    publication lock, the one-current index, withdraw and audit, and they refuse
    legacy snapshots.
- Importer accepts exactly `level,rank,public_name` (30 rows, 10 per level).
  Hidden, look-alike and fullwidth characters are rejected, and duplicate checks
  use NFKC. The real Week 5 file passes locally; it is never committed or uploaded.
- UI and API are level-only and deployed to both hosts. The independent review
  found no unresolved blockers.
- **Owner checklist (in order):**
  1. **Migrate staging.** In Terminal, in this repo, run the command below and
     click Allow on the keychain prompt:
     `node scripts/hosted-sql.mjs cynfnxlbmthjxgivllkg migrate && node scripts/hosted-sql.mjs cynfnxlbmthjxgivllkg query "select (select count(*) from supabase_migrations.schema_migrations) migrations, (select string_agg(distinct tableowner, ',') from pg_tables where schemaname in ('public','app_private')) owners, (select allow_fictional_account_lifecycle from app_private.runtime_controls) lifecycle_gate"`
     Expected result: `migrations` 11, `owners` postgres, `lifecycle_gate` false.
  2. **Bootstrap the staging admin.** In the Supabase dashboard, go to Auth → Add
     user. Use your own mailbox, a generated password, and auto-confirm. Then run
     `select app_private.operator_bootstrap_initial_admin('<uuid>','<username>');`
     in the SQL editor. Sign in at staging, change the password, and enroll TOTP.
     Then let Claude run the fictional publish/rollback/withdraw check in the
     browser pane.
  3. **Migrate production.** Run step 1 with `jhukafyrdredfkzyzggw`.
  4. **Set up the production admin** (step 2 on production), using an identity
     approved for Supabase processing.
  5. **Publish the real file**, once the university's written approval for
     public disclosure exists. Staff Desk → year `2026-27`, label `Week 5`,
     upload, review the preview, then publish.

## 2026-11-17 — Hosted deployment (branch `m5/hosted-deployment`)

- **Deployed:** production https://academic-arena.pages.dev and staging https://academic-arena-staging.pages.dev. Each is a separate Pages project with its own 6 encrypted settings. Hosted checks are in `docs/operations/deployment-status.md`.
- **Fixed:** unknown `/api/*` paths returned the HTML shell with status 200; they now return a JSON 404.
- **Blocked:** this machine's network resets Postgres connections to the Supabase pooler, so `db push` fails. `scripts/hosted-sql.mjs` applies migrations over HTTPS instead, but needs the owner's keychain approval. Until then both sites fail closed ("temporarily unavailable").
- **Owner checklist (in order):**
  1. In Terminal in this repo, run `node scripts/hosted-sql.mjs cynfnxlbmthjxgivllkg migrate`. Allow the keychain prompt. Expect 10 "applied" lines.
  2. Check staging: `node scripts/hosted-sql.mjs cynfnxlbmthjxgivllkg query "select count(*) from supabase_migrations.schema_migrations"` should return 10. Then open https://academic-arena-staging.pages.dev; the empty state should read "No cohorts are available…".
     Also check object ownership: `node scripts/hosted-sql.mjs cynfnxlbmthjxgivllkg query "select tableowner, count(*) from pg_tables where schemaname in ('public','app_private') group by 1"` should show `postgres` only.
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
