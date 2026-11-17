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
scripts/db-backup.sh export linked /secure/offsite/academic-arena-$(date +%F).aabk
```

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
          (select allow_fictional_account_lifecycle from app_private.runtime_controls) lifecycle_gate;
   ```
   Compare with the counts recorded at export time; `lifecycle_gate` must be `false`.
5. Point the Pages environment at the new project (`SUPABASE_URL` and
   `configure-pages-secrets.sh`), redeploy, and sign in with a staff account.
   Rotating `SESSION_JWE_KEY` here signs everyone out, which is intended.

Excluded by design: live credentials and transient state (`auth.refresh_tokens`,
`auth.sessions`, `auth.mfa_amr_claims`, `auth.mfa_challenges`,
`auth.one_time_tokens`, `auth.flow_state`, `auth.saml_relay_states`,
`auth.audit_log_entries`, `app_private.bff_sessions`,
`app_private.login_rate_limit_buckets`) and tables recreated by migrations
(`auth.schema_migrations`, `app_private.role_permissions`,
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
