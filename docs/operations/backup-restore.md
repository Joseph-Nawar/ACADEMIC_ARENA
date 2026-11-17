# Backup and restore

Supabase Free has no managed backups. The schema is in Git
(`supabase/migrations`); `scripts/db-backup.sh` exports **data** (Auth users,
private account tables, public projections) as an AES-256 (PBKDF2, 600k
iterations) encrypted file with a SHA-256 checksum.

The export contains password hashes, emails, and private mappings. Treat it
as confidential: never commit it, never store it in the repository folder
(the script refuses), and keep the passphrase in the custodian's password
manager, separate from the file.

## Weekly export (term time) and before every migration or bulk publication

```bash
npx supabase link --project-ref <prod-ref>
scripts/db-backup.sh export linked /secure/offsite/academic-arena-$(date +%F).sql.enc
```

Copy the `.sql.enc` and `.sql.enc.sha256` to an institution-approved offsite
location (for example an encrypted university drive). Keep at least 4 weekly
and 3 monthly copies; delete older ones per the approved retention period.

## Restore

1. Create a fresh Supabase project (or reset the damaged one only if approved).
2. Apply the schema: `npx supabase link --project-ref <new-ref> && npx supabase db push`.
3. Put the target connection string in an environment variable without echoing it:
   `read -rs AA_RESTORE_DB_URL && export AA_RESTORE_DB_URL`.
4. `scripts/db-backup.sh restore AA_RESTORE_DB_URL /secure/offsite/<file>.sql.enc`
   (checksum verified, decrypted to a temporary directory, applied as one
   all-or-nothing transaction, temporary files deleted).
5. Verify:
   ```sql
   select (select count(*) from auth.users) users,
          (select count(*) from app_private.accounts) accounts,
          (select version_number from public.published_leaderboard_snapshots where is_current) live,
          (select count(*) from public.campus_wins_public) wins,
          (select allow_fictional_account_lifecycle from app_private.runtime_controls) lifecycle_gate;
   ```
   Compare with the counts recorded at export time; `lifecycle_gate` must be `false`.
6. Point the Pages environment at the new project (`SUPABASE_URL` and
   `configure-pages-secrets.sh`), redeploy, and sign in with a staff account.
   Rotating `SESSION_JWE_KEY` here signs everyone out, which is intended.

Excluded by design: `auth.schema_migrations`, `app_private.role_permissions`,
and `app_private.runtime_controls` (recreated by migrations; the lifecycle gate
stays off). MFA factors are included, so staff keep their authenticators.

## Restore drill — 17 Nov 2026 (local, fictional data)

1. Seeded fictional data on the local stack: 2 Auth users created via the
   Auth Admin API, accounts, a live publication, and an approved Campus Win.
2. `export local` → OpenSSL `Salted__` ciphertext; no plaintext email found in the file.
3. `supabase db reset` (bare migrations): all counts 0.
4. `restore local` → counts identical to before
   (users 2, accounts 2, board rows 2, live v1, wins 1, audits 1).
5. A restored user signed in through GoTrue with the original password: HTTP 200.
6. Drill files and the passphrase were deleted.

Repeat the drill against the hosted staging project after the first hosted
deployment, and once per term.
