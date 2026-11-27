# Progress notes

Keep short. Newest first.

## 2026-11-27 — Release B1: Character Studio V2 art engine and studio (branch `release-b/character-studio-v2`)

- **Built (fictional demo only; production behaviour unchanged):**
  - an original modular SVG character engine (`assets/avatar-v2/`): 12 skin tones, 6 faces, 4 builds, 22 hairstyles, 16 hair colours, 8 eye shapes, 10 eye colours, 8 brows, 6 noses, 10 expressions, 10 facial-hair styles, 4 headscarf styles plus a head wrap and hats, makeup and facial details, glasses, hearing aids, a cochlear processor, cane, crutches, a wheelchair (seated pose), clothing, backdrops and stickers;
  - one renderer for full body, portrait, face, torso and legs; the same config draws the studio, the podium and the rank thumbnails;
  - My Character → Create / Wardrobe / Arena Pass, with:
    - undo and redo;
    - randomize (owned and compatible items only) and reset;
    - unsaved-change state;
    - try-on of locked items, which cannot be saved;
    - a reward celebration that respects reduced motion;
    - a Classic/Custom switch, so the classic look is kept;
  - collections: Essentials (free, every identity and access option), Elite, Podium, Champion, plus Scholar and Seasonal, which stay inactive;
  - reward rules `collectionsForPosition`: Top 10 → Elite; Top 3 → adds Podium; first → adds Champion;
  - reference doc: `docs/design/character-v2.md` (coordinates, layers, compatibility rules, provenance); contact sheet: `docs/design/avatar-v2-sheet.html`.
- **Production:** `studio-v2.js` exits outside the demo, so production shows the classic studio. Public rows render V2 only when the server sends a valid `v2` config, and none does yet.
- **Fixed in passing:** `staff.js` could miss the first `arena:session` event if it loaded late (seen as an intermittent missing Staff Desk once more scripts loaded). It now reads the latest session on load.
- **Tests:**
  - `tests/frontend/avatar-v2.test.mjs`: catalogue targets, free identity items, the validator contract, ownership, compatibility, reward rules, every option rendering CSP-safe SVG, a fuzz test, hostile input and provenance;
  - `tests/browser/v2-character-studio.spec.mjs`: desktop and mobile, keyboard, reduced motion, the board, and production hiding V2;
  - `npm test` 120/120 (the `process_cleanup` EPERM is a sandbox flake that passes on rerun); `npm run test:browser` passed twice; `check:security` passed.
- **Not yet tested:** WebKit/Safari, because the Playwright WebKit build is not installed.
- **Next:**
  - B2: additive migration with V2 config, catalogue, entitlements and append-only reward events; server-side validation and equip checks; an extended public projection; a Campus Wins consent projection (#25); the `character_studio_v2` switch.
  - B3: Arena Pass tables behind a switch, the hosted staging gate, the release procedure.

## 2026-11-23 — Release A: public character sync (branch `release-a/public-character-sync`)

- **Cause (production, read-only):** 0 verified account links have ever been approved (no `leaderboard.links_approved` audit event). 27 characters are saved and 21 opted in, `avatar_personalization` is on, and 30 of 30 rows have reviewed defaults. The board therefore shows 0 personalized rows. Save, opt-in, projection, API and caching all work.
- **Fix needed in operations:** approve Week 5 links, per `docs/operations/verified-links-runbook.md`.
- **Code (migration `202611230001`, not yet on production):**
  - `my_character_publication_state()` returns the caller's state: not saved, saved privately, public display off, awaiting staff verification, or public. "Public" is decided by the anonymous projection itself.
  - My Character shows that state and flags unsaved edits.
  - Personalized board rows keep the saved style, backdrop and sticker. Defaults stay 3D.
  - Open board tabs refetch when shown again after a minute away.
  - Staff Desk lists the current links and downloads them as CSV. The preview lists any links an upload would remove, because approval replaces the whole set.
- **Tests:**
  - pgTAP `v17_character_publication_state`;
  - M2 `v17-character-publication`: save, opt-in, link, re-save, replace-all, opt-out, switch, replacement, rollback, suspension, withdrawal;
  - browser `v17-public-character`: desktop and mobile screenshots.
- **Hosted staging gate (2026-11-23):** 31 of 31 checks passed, plus not-saved in a first run. Used a temporary fictional admin (TOTP enrolled through the app) and three fictional students who changed their temporary passwords. Covered: link approval in Staff Desk, signed-out podium and rank 6 on desktop and mobile, a re-save shown on the next load without a new approval, opt-out and opt-in, replacement, rollback, suspension and withdrawal.
  - Afterwards all 7 fixtures were suspended, banned, had their factors deleted, and have 0 live app sessions. The admin was created by owner SQL and its factor was reset through the Auth Admin API between reruns, not through the recovery runbook. Staging has 0 live publications.
  - Migration `202611230001` is applied to staging only.
- **Visual review follow-up (hosted):**
  - My Character now re-asks the server on every visit. Before, an open tab could show an outdated state, including a stale "PUBLIC NOW".
  - An untouched studio now shows a look saved on another device.
  - The hosted re-run passed 35 of 35 checks; its fixtures were cleaned up the same way.
  - A second review (2026-11-24) fixed: an edit made while the status was "CHECKING…" was lost; the link tool joined student numbers mangled by a spreadsheet, accepted paths in other checkouts, and made the version cross-check optional. Added browser tests for the save/sign-out race, that edit, and the open-tab refetch.
  - **Fixture state (checked 2026-11-24):** 3 admins and 12 students, all suspended and banned, 0 TOTP factors, 0 live app sessions. 18 Supabase `auth.sessions` rows remain: the Admin API cannot revoke them. Their access tokens have expired and a banned user cannot refresh.
- **Final release gates (2026-11-25):**
  - `scripts/release-production.mjs verify|migrate|deploy|smoke` refuses to touch production unless the checkout is exactly the reviewed tree, clean, on the current `origin/main`, with every CI check for that commit green. `migrate` must be told the exact migration it expects, and each step asks for a typed confirmation. Tests: `tests/frontend/release-guard.test.mjs`.
  - Hosted staging gate on the final build: 27 of 27, reusing the existing suspended fixtures (no new accounts). It added a separate signed-out browser, an already-open tab picking up a re-save, and an open studio tab after a replacement.
  - Follow-ups filed: issue #24 (72-byte passwords) and issue #25 (Campus Wins consent).
- **New:**
  - `scripts/build-link-csv.mjs`, an offline tool that builds the link file by joining on email or `roster_ref` only;
  - `docs/operations/release-a-deploy.md`, the owner's production steps;
  - `docs/design/campus-wins-character-consistency.md`. Campus Wins snapshots the look at approval and ignores opt-in, which is for V2 to fix. Production has 0 posts.
- **Found (pre-existing, not fixed here):** Supabase Auth (bcrypt) rejects passwords over 72 bytes, but `validNewPassword` allows up to 128. A long new password fails as "password change failed".

## 2026-11-20 — V1.6 student sign-in incident hotfix (branch `hotfix/student-login-lifecycle`)

- **Production evidence (read-only):**
  - 77 student accounts were created once each (77 Auth creates, 0 admin password updates, 0 orphans).
  - Every Auth failure that could be attributed happened on the first sign-in after that student's own password change: one 4 s after it.
  - One student was then locked out by the per-username limit, because their own successful sign-in and password change counted as attempts.
  - The IP limit was never reached (peak 18 per 15 minutes).
- **Fix** (migration `202611200002`):
  - The limiter counts failures only for students: 8 per username and 100 per IP per 15 minutes. Staff keep counting successes, because their TOTP checks share that allowance.
  - Students stay signed in after changing their password.
  - An Auth update with no answer returns "uncertain" instead of "failed".
  - The change form carries a hidden `autocomplete=username` field.
  - Private reason codes go to `app_private.auth_diagnostic_events` (no PII, 7 days, flood budgets).
- **Investigate a failed sign-in:**
  - read the private reason codes, newest first: `select occurred_at, flow, stage, outcome, temporary_password from app_private.auth_diagnostic_events where account_id = (select account_id from app_private.identity_mappings where username_normalized = '<username>') order by id desc limit 20`
  - run it as the owner with `node scripts/hosted-sql.mjs <ref> query "…"`.

## 2026-11-19 — V1.5 pilot fixes

Pilot started: 2 student accounts, `student_sign_in` and `student_provisioning` on; `avatar_personalization` and `welcome_dialog` off.

- **`user-two`'s character (read-only check, no data changed):** account active, password changed, a character is saved. It is not public for three rollout reasons, none of them a bug:
  1. `avatar_personalization` is off;
  2. `show_on_leaderboard` is false (the opt-in box is hidden while that switch is off);
  3. there is no verified link to any Week 5 row (0 links in the current publication).
  The public projection behaves correctly: 30 rows with staff-approved defaults, 0 personalized. The new pgTAP file `v15_avatar_publication_conditions` covers each condition.
- **Account UX fixes:**
  - The password form shows only when it is required or chosen (CHANGE PASSWORD), and needs a confirmation.
  - After a change, the form clears and the dialog says to sign in with the new password (username kept, focus on password).
  - Normal sign-in gives one next action: My Character or Staff Desk.
  - A temporary password reopens the dialog after a refresh.
  - The saved character loads after sign-in and is cleared on sign-out (before, it loaded only at page start).
  - **Bug fixed:** a slow initial session check could overwrite a fresh sign-in, so the header showed SIGN IN while signed in. Session results are now versioned; a failed check is retried; the state is re-checked after a back/forward restore or a long time in the background.
  - New browser spec: `tests/browser/v15-account-ux.spec.mjs` (desktop and mobile).
- **How it works:** rewritten around the Academic Score (start 0, +1 per quiz attended, −1 per warning, normal attendance ±0, ties by total quiz score), with a 5 − 2 = 3 example. Scores stay private.
- **Methodology check:** the Week 5 source workbook ranks quizzes attended, then quiz scores, and has **no warnings column**. The site says so: the subtitle reads "Ranked by quizzes attended, then quiz scores." There is also a Week 5 note. Warning-adjusted boards need approved warnings data. The Level 4 rank 10 is fully tied with rank 11 in the source.

## 2026-11-20 — V1.4 final release pass

- **Board characters.** The original 3D Cartoon cast is back on every board.
  - Each publication gets staff-reviewed default characters. Migration `202611200001` adds `app_private.published_level_row_artwork`: position plus an allowlisted key only, with AAL2 publisher approval and an audit entry.
  - Staff Desk → Board characters can pre-fill from first names in the browser only, flagging unisex and unknown names. It never suggests the headscarf or wheelchair characters. Nothing inferred is stored or sent.
  - New weeks start empty: no carry-over by rank. Rollback restores that week's set.
  - Precedence: student's own opted-in character, then the reviewed default, then a neutral illustration. The podium and thumbnails are always 3D.
- **EUE identity:** a bold text lockup (no approved logo file exists in the repo) and "University of London · Computer Science" in the header.
- **UI walkthrough (local, fictional):** 28 of 28 checks pass. One bug fixed: the publication pickers didn't refresh after a publish.
- **Released** (PR #16, `4bd2f70`). Migration `202611200001` is applied to staging and production (13 migrations), and both sites are deployed. Production rankings were re-verified: one Week 5 version, unchanged hash, no audit writes, all student switches off. **No board characters are approved yet**, so production shows the neutral illustration until staff review Week 5.

### Owner checklist to finish launch

1. **Week 5 board characters** (about 10 minutes):
   - sign in to production as admin;
   - Staff Desk → Board characters → v1 Week 5 → Load rows → Suggest from first names;
   - check all 30 rows: 3 are flagged (2 unrecognised names, 1 unisex) and need your decision;
   - choose the headscarf or wheelchair character only where you know it is right;
   - tick each row, then Approve.
2. **University authorization, in writing:**
   - processing the roster and institutional emails in Supabase (EU region);
   - the private credential-delivery channel;
   - public display of students' chosen characters.
3. **Pilot**, per `docs/operations/student-accounts.md` → Launch sequence: 3–5 students from the private roster through the local CLI, then batches of 25 or fewer, then the welcome dialog.
4. **Official EUE logo**, optional: if the university supplies an approved asset, it can replace the text wordmark.


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
