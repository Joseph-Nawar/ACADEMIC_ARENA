# Release A: production deployment steps (owner)

Release A changes:
- one append-only migration, `202611230001_character_publication_state.sql`,
  which adds **one function** and no table or data changes;
- the Pages build: studio status, board look, Staff Desk link safety.

It changes no rankings, links, accounts or switches. Run these steps on the
internal disk, not `/Volumes/JOSEPH`. Stop at the first step that doesn't
match.

## 0. Approve and merge

1. Review [PR #23](https://github.com/Joseph-Nawar/ACADEMIC_ARENA/pull/23)
   and the staging screenshots. Wait for CI to be green.
2. Merge it on GitHub with a normal merge commit.

## 1. Fresh checkout and gates

```bash
mkdir -p ~/Developer && cd ~/Developer && git clone https://github.com/Joseph-Nawar/ACADEMIC_ARENA.git aa-release-a && cd aa-release-a
git log --oneline -1          # the PR #23 merge commit
git diff --quiet origin/release-a/public-character-sync HEAD && echo "same code as reviewed"   # must print; stop if it doesn't
npm ci
npm test
npm run check:security
```

## 2. Backup (recommended before any production migration)

On a network where the preflight prints *Ready*:

```bash
npx supabase link --project-ref jhukafyrdredfkzyzggw
node scripts/backup-preflight.mjs jhukafyrdredfkzyzggw
scripts/db-backup.sh export linked /secure/offsite/academic-arena-$(date +%F).aabk   # you type the passphrase
npx supabase link --project-ref cynfnxlbmthjxgivllkg
```

## 3. Migration (dry-run first)

```bash
node scripts/hosted-sql.mjs jhukafyrdredfkzyzggw migrate --dry-run
```

Expect exactly one line `would apply 202611230001_character_publication_state.sql`,
and every other migration listed as `already applied`. Then:

```bash
node scripts/hosted-sql.mjs jhukafyrdredfkzyzggw migrate
node scripts/hosted-sql.mjs jhukafyrdredfkzyzggw query "select has_function_privilege('anon','public.my_character_publication_state()','execute') as anon, has_function_privilege('authenticated','public.my_character_publication_state()','execute') as authenticated"
```

Expect `anon: false, authenticated: true`.

## 4. Deploy Pages

```bash
npm run build:production
npx wrangler pages deploy dist --project-name academic-arena --branch main
```

## 5. Smoke checks (read-only)

```bash
for l in 4 5 6; do curl -s -D - -o /dev/null "https://academic-arena.pages.dev/api/public/leaderboards?level=$l" | grep -iE "^HTTP|cache-control"; done
curl -s -o /dev/null -w "%{http_code}\n" https://academic-arena.pages.dev/api/me/avatar
curl -s -o /dev/null -w "%{http_code}\n" "https://academic-arena.pages.dev/api/staff/leaderboards/links?publicationId=00000000-0000-4000-8000-000000000000"
```

Expect `200` with `private, no-store` for each level, then `401` and `401`.

Then check in the browser:
- **Private window, signed out:** the Week 5 boards look as before, with the
  reviewed 3D defaults. There are 0 personalized rows until links exist.
- **Your admin, after TOTP:** Staff Desk → Verified account links shows
  **CURRENTLY APPROVED (0)** for v1 Week 5.
- **Optional:** a pilot student opens My Character and sees **PUBLIC DISPLAY ON ·
  NOT SHOWN YET**. Students who opted in see this until links are approved.

## 6. Rollback

- **App:** Cloudflare dashboard → Pages → `academic-arena` → Deployments →
  previous production deployment → *Rollback to this deployment*.
- **Database:** the new function is additive and read-only for students. The
  previous build simply doesn't call it, so leaving it in place is safe. If it
  must go, write a new corrective migration with
  `drop function public.my_character_publication_state();`. Never edit an
  applied migration.

## 7. Then: verified links

Follow [verified-links-runbook.md](verified-links-runbook.md). Build the file
with `scripts/build-link-csv.mjs`, preview it in Staff Desk, and approve it with
your TOTP check. Nothing in this release approves links automatically.
