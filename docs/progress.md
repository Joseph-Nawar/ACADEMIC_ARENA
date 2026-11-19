# Progress notes

Keep short. Newest first.

## 2026-11-19 — V1.3 production polish

- **Anonymous default artwork.** Ranks without a verified, opted-in student character now show original anonymous competitor art (`assets/competitors/`, made by `scripts/generate-competitors.mjs`):
  - faceless hooded figures with no skin, hair, face or religious cues;
  - gold, silver and bronze differ only by colour, pose and emblem;
  - ranks 4–10 use three coordinated thumbnails.
- The public API no longer sends artwork for default rows: they are `{position, name, personalized: false}`. Rank-assigned human presets (`RANK_ARTWORK`) are gone. Student-chosen characters, links, opt-in and opt-out are unchanged.
- **Copy.** Removed:
  - the sidebar development notes;
  - the "draft wordmark" graphic, replaced by a plain-text EUE wordmark;
  - prototype and filler copy.
  How it works is rewritten. "Characters are illustrative until students choose their own." now appears once, under the podium.
- **Student-only promotions** (My Character, the profile chip, character CTA, Share a win, the Signing in section) follow the backend `student_sign_in` switch, so they are hidden in production today.
- No migration, no data change, no switch change.

## 2026-11-18 — V1.2 release gates (PR #14)

V1.2 shipped in PRs #10–#13. Both sites run `main`. Known CI flake: `v12-student-accounts` once hung ("Promise resolution is still pending") and passed on rerun. Older owner checklists further down are superseded by the one below.

- **Hosted staging gate passed** with fictional data and the owner's AAL2 admin. Covered: private link approval, opt-in avatar at the correct position, change and opt-out without republishing, per-version links and rollback. Staging is withdrawn (0 live), and its student switches stay on for fictional testing.
- **Production unchanged** (read-only check). The DB rows, public API and approved Week 5 file share one hash. There are no V1.2 tables, so every student feature is off.
- **Backup route:**
  - The direct host is IPv6-only. The CLI's linked dump uses the IPv4 session pooler (`aws-1-eu-west-1:5432`) with a temporary login role, so no password is needed.
  - The earlier resets were this network's DNS (SERVFAIL for `api.supabase.com`).
  - A staging drill (export, then restore into a local stack) matched all counts. It found `student_feature_controls` missing from the backup exclusions, which is now fixed and guarded by a test.
  - New: `scripts/backup-preflight.mjs`.
- **Artwork:** `docs/design/avatar-artwork-spec.md`, enforced by `tests/frontend/avatar-assets.test.mjs`. The inclusive library is **not** complete; there is still no new art.
- **Review fixes:**
  - the legacy CSV importer now shares the character allowlist;
  - the constraint lists are tested;
  - the password fallback is scoped to a subshell;
  - the preflight checks that the pooler URL belongs to the project;
  - pending credential-sync rows are excluded from backups.

### Owner checklist (the only remaining steps before real student accounts)

1. **University authorization, in writing:**
   - processing the student roster and institutional emails in Supabase (EU region);
   - the username scheme;
   - the approved private channel for verifying identity and delivering credentials;
   - public display of the linked students' chosen characters.
2. **Production backup.** On a network where `node scripts/backup-preflight.mjs jhukafyrdredfkzyzggw` prints *Ready*:
   ```bash
   npx supabase link --project-ref jhukafyrdredfkzyzggw
   node scripts/backup-preflight.mjs jhukafyrdredfkzyzggw
   scripts/db-backup.sh export linked /secure/offsite/academic-arena-$(date +%F).aabk   # you type the passphrase
   npx supabase link --project-ref cynfnxlbmthjxgivllkg
   ```
   Then copy the `.aabk` and `.sha256` files offsite. Keep the passphrase only in your password manager.
3. **Production migration**, only after step 2. Expect `applied 202611190001…`; every student switch is created off:
   ```bash
   node scripts/hosted-sql.mjs jhukafyrdredfkzyzggw migrate
   ```
4. **Pilot**, only after step 1:
   - turn on `student_provisioning` and `student_sign_in` (`features --set … --confirm-production`);
   - provision 3–5 pilot students from the private roster on your device, and deliver credentials one at a time;
   - link them in Staff Desk, then turn on `avatar_personalization`;
   - check opt-in and opt-out;
   - runbook: `docs/operations/student-accounts.md`.
5. **Broad activation:** roster batches of 25 or fewer, then `welcome_dialog`. The incident switch is `student_sign_in=off`.
6. **Artwork:** commission the inclusive set per `docs/design/avatar-artwork-spec.md`. It ships only after the integration tests and a visual review pass.

## 2026-11-18 — V1.2 Phase B: student account foundation (all switches off)

- Migration `202611190001`, append-only:
  - default-off switches `student_sign_in`, `student_provisioning`, `avatar_personalization` and `welcome_dialog`, which only the owner can change (audited);
  - student permissions now also require `student_sign_in`;
  - a private `published_level_row_links` table (per snapshot), approved by AAL2 admins by username only;
  - the opt-in `show_on_leaderboard` setting;
  - the `public_level_leaderboard_v2` projection, which returns only allowlisted artwork;
  - owner-only provisioning, recovery and status functions, which never write `auth.*`.
- `scripts/student-accounts.mjs`:
  - roster validation, bounded and idempotent batches, and explicit orphan adoption;
  - encrypted credential export with one-at-a-time clipboard delivery;
  - locked-first recovery, suspension, and the rollout switches.
- UI:
  - opt-in toggle in My Character;
  - private link review in Staff Desk;
  - a welcome dialog controlled by the backend switch;
  - a sign-in explanation in How it works.
- **Artwork limitation:** no new characters were added, because no matching illustration tooling was available. See `docs/design/avatar-library.md`.
- Runbook: `docs/operations/student-accounts.md`.

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
