# Backup and restore

Supabase Free has no managed backups. The schema is in Git
(`supabase/migrations`); `scripts/db-backup.sh` exports **data** (Auth users and
identities, MFA factors, private account tables, public projections) as an
authenticated-encrypted file (scrypt N=2^17 + AES-256-GCM via Node's built-in
crypto; any modification or a wrong passphrase makes decryption fail).

The export contains password hashes, emails, TOTP factor seeds, and private
mappings: anyone with the file **and** the passphrase can compromise every
account. Use a long generated passphrase (≥ 24 characters, e.g.
`openssl rand -base64 33`), keep it only in the custodian's password manager,
never commit or store the file in the repository folder (the script refuses),
and keep it apart from the file. Live credentials are never exported: refresh
tokens, provider and BFF sessions, MFA challenges, one-time tokens, and
rate-limit buckets are excluded, so restored users simply sign in again.

## Weekly export (term time) and before every migration or bulk publication

```bash
npx supabase link --project-ref <prod-ref>
node scripts/backup-preflight.mjs <prod-ref>      # credential-free; must print "Ready"
scripts/db-backup.sh export linked /secure/offsite/academic-arena-$(date +%F).aabk
npx supabase link --project-ref cynfnxlbmthjxgivllkg   # relink staging afterwards
```

### Connection route (verified 18 Nov 2026)

- The direct database host `db.<ref>.supabase.co` is **IPv6-only** on Supabase Free. This network has no IPv6, so it can't be used.
- `supabase db dump --linked` instead uses the **session-mode pooler** saved by `supabase link` (`aws-1-<region>.pooler.supabase.com:5432`, IPv4). It authenticates with a temporary login role minted through the Management API, so no database password is typed or stored. This is the official route and needs no SQL workaround.
- The earlier "connection reset" failures came from this network's DNS resolver, which intermittently returns SERVFAIL for `api.supabase.com`; the pooler itself was reachable. `backup-preflight.mjs` checks DNS, the Management API, pooler TCP + TLS, the linked ref and Docker. If DNS fails, retry later or use another network. Do not change the backup script.
- If the login-role step still fails while DNS works, the supported fallback is the database password, scoped to one subshell so it never lingers. Never pass it as an argument:
  `( read -rs SUPABASE_DB_PASSWORD && export SUPABASE_DB_PASSWORD && scripts/db-backup.sh export linked /secure/offsite/academic-arena-$(date +%F).aabk )`

Excluded seeded tables (`role_permissions`, `runtime_controls`, `student_feature_controls`, and since Release B the generated catalogue `cosmetic_collections`, `character_v2_fields`, `character_v2_values`, `rank_reward_rules`) keep the target project's values, which the migrations create. After a restore, every student switch is therefore **off** until you re-enable it deliberately.

Copy the `.aabk` and `.aabk.sha256` to an institution-approved offsite
location (for example an encrypted university drive). Keep at least 4 weekly
and 3 monthly copies; delete older ones per the approved retention period.

## Restore

1. Create a fresh Supabase project (or reset the damaged one only if approved).
2. Apply the schema: `npx supabase link --project-ref <new-ref> && npx supabase db push`.
3. Keep that project linked and run
   `scripts/db-backup.sh restore linked /secure/offsite/<file>.aabk`
   (asks you to type the linked project ref back, then the passphrase; checksum
   and GCM tag verified; applied through
   the Management API as one all-or-nothing transaction; no database URL or
   password in process arguments; temporary files deleted; `pg_stat_statements`
   is reset afterwards because the statement text contains credential
   material). Hosted Postgres logs may still record the statement if it
   fails; treat the project's log retention accordingly.
4. Verify:
   ```sql
   select (select count(*) from auth.users) users,
          (select count(*) from app_private.accounts) accounts,
          (select version_number from public.published_leaderboard_snapshots where is_current) live,
          (select count(*) from public.campus_wins_public) wins,
          (select allow_fictional_account_lifecycle from app_private.runtime_controls) lifecycle_gate,
          (select student_sign_in or student_provisioning or avatar_personalization or welcome_dialog
             from app_private.student_feature_controls) switches_on,
          -- Release B (after migration 202611270001):
          (select count(*) from public.student_avatar_configs where v2_config is not null) v2_looks,
          (select count(*) from app_private.cosmetic_entitlements where revoked_at is null) active_entitlements,
          (select count(*) from app_private.reward_periods) periods,
          (select count(*) from app_private.reward_events) reward_events,
          (select count(*) from app_private.character_v2_values) catalogue_values;
   ```
   Compare with the counts recorded at export time; `lifecycle_gate` and `switches_on` must be `false`.
5. Point the Pages environment at the new project (`SUPABASE_URL` and
   `configure-pages-secrets.sh`), redeploy, and sign in with a staff account.
   Rotating `SESSION_JWE_KEY` here signs everyone out, which is intended.

Excluded by design: live credentials and transient state (`auth.refresh_tokens`,
`auth.sessions`, `auth.mfa_amr_claims`, `auth.mfa_challenges`,
`auth.one_time_tokens`, `auth.flow_state`, `auth.saml_relay_states`,
`auth.audit_log_entries`, `app_private.bff_sessions`,
`app_private.login_rate_limit_buckets`, `app_private.credential_sync_operations`) and tables recreated by migrations
(`auth.schema_migrations`, `app_private.role_permissions`, `app_private.student_feature_controls`,
`app_private.runtime_controls`, so the lifecycle gate stays off). MFA factors
are included, so staff keep their authenticators.

## Restore drill — 17 Nov 2026 (local, fictional data)

1. Seeded fictional data on the local stack: 2 Auth users created via the
   Auth Admin API, accounts, a live publication, and an approved Campus Win.
2. `export local` → `AABK1` authenticated ciphertext; the decrypted dump held
   only user, identity, account, mapping, role, audit, publication, and Campus
   Wins rows (no token or session rows). A one-byte modification was rejected.
3. `supabase db reset` (bare migrations): all counts 0.
4. `restore local` → counts identical to before
   (users 2, accounts 2, board rows 2, live v1, wins 1, audits 1).
5. A restored user signed in through GoTrue with the original password: HTTP 200.
6. Drill files and the passphrase were deleted.

Re-check the exclusion list whenever the Supabase CLI/Auth version changes
(new `auth.*` token tables must be excluded). Repeat the drill against the hosted staging project after the first hosted
deployment, and once per term.

## Hosted drill — 18 Nov 2026 (staging, fictional data)

- Ran `db-backup.sh export linked` against staging over the IPv4 session pooler.
- Restored the encrypted file into a freshly migrated local stack with `restore local`.
- All counts matched: 3 users, 1 MFA factor, 3 accounts, 32 audit events, 2 versions, 60 level rows, 2 avatars.
- The drill found that `student_feature_controls` (seeded by migration 202611190001) was missing from the exclusions, so restores failed. It is now excluded, and a unit test checks every migration-seeded table.
- Drill files were deleted afterwards.

## Restore drill — 27 Nov 2026 (local, fictional data, Release B)

1. Seeded the local stack with `scripts/b2-local-demo.mjs`: 3 Auth users,
   2 saved custom (V2) looks, 4 entitlements, 1 earning period, 1
   publication binding and 6 reward history events.
2. `export local` → encrypted `.aabk`. Then `supabase db reset`: all data
   gone, while the migrations recreated the catalogue (339 values, 6
   collections).
3. `restore local`, then compared counts and an MD5 of every stored V2 config,
   ordered by account. Before and after were identical:

   | | Count |
   |---|---|
   | users | 3 |
   | accounts | 3 |
   | avatars | 2 |
   | V2 looks | 2 (same hash) |
   | entitlements | 4 (4 active) |
   | periods | 1 |
   | bindings | 1 |
   | reward events | 6 |
   | links | 2 |

   The `reward_events` identity sequence was restored too (last value 6), so
   new history rows continue without a clash. The append-only trigger does
   not block a restore, because it blocks only UPDATE, DELETE and TRUNCATE.
4. Drill file and passphrase deleted afterwards.
