# Release A: production deployment steps (owner)

Release A changes:
- one append-only migration, `202611230001_character_publication_state.sql`,
  which adds **one function** and no table or data changes;
- the Pages build: studio status, board look, Staff Desk link safety.

It changes no rankings, links, accounts or switches. Run these steps on the
internal disk, not `/Volumes/JOSEPH`. Stop at the first step that doesn't
match.

## 0. Approve and merge

1. Review [PR #23](https://github.com/Joseph-Nawar/ACADEMIC_ARENA/pull/23),
   the staging screenshots and the CI results for the final head commit.
2. Note the **reviewed tree id** from the release report. It is also in a PR
   comment, and you can recompute it yourself on any machine:
   `git fetch origin pull/23/head && git rev-parse FETCH_HEAD^{tree}`.
   It identifies the exact reviewed files. It is deliberately not stored in
   this repository.
3. Merge on GitHub with a **normal merge commit**. A squash or rebase changes
   the tree only if `main` moved; if it did, the checks below stop you.
4. Wait for CI on the merge commit to finish green.

## 1. Fresh checkout (nothing is touched in production yet)

Run on the internal disk, not `/Volumes/JOSEPH`. Replace `<TREE>` with the id
from step 0.2.

```bash
mkdir -p ~/Developer && cd ~/Developer && git clone https://github.com/Joseph-Nawar/ACADEMIC_ARENA.git aa-release-a && cd aa-release-a
npm ci
node scripts/release-production.mjs verify --tree <TREE>
npm test && npm run check:security
```

`verify` stops, naming the reason, unless **all** of these hold:
- the checked-out files are exactly the reviewed tree;
- the working tree has no modified, untracked or relevant ignored files
  (`.dev.vars`, `.env`, private data);
- HEAD is `main` and is the current `origin/main`;
- GitHub reports at least two CI checks for this exact commit, all completed
  and successful. An unreadable result counts as a failure.

Don't continue past a `STOP:` line. Every later step runs the same check again.

## 2. Backup (recommended before any production migration)

On a network where the preflight prints *Ready*:

```bash
npx supabase link --project-ref jhukafyrdredfkzyzggw
node scripts/backup-preflight.mjs jhukafyrdredfkzyzggw
scripts/db-backup.sh export linked /secure/offsite/academic-arena-$(date +%F).aabk   # you type the passphrase
npx supabase link --project-ref cynfnxlbmthjxgivllkg
```

## 3. Migration

```bash
node scripts/release-production.mjs migrate --tree <TREE> --expect 202611230001_character_publication_state.sql
```

It verifies the checkout, runs the dry run, and stops unless the pending
migrations are **exactly** the one you named. Then it asks you to type `APPLY`,
verifies again, and applies. Afterwards check the privileges:

```bash
node scripts/hosted-sql.mjs jhukafyrdredfkzyzggw query "select has_function_privilege('anon','public.my_character_publication_state()','execute') as anon, has_function_privilege('authenticated','public.my_character_publication_state()','execute') as authenticated"
```

Expect `anon: false, authenticated: true`.

## 4. Deploy Pages

```bash
node scripts/release-production.mjs deploy --tree <TREE>
```

It verifies, builds production, verifies again, asks you to type `DEPLOY`, and
uploads exactly that build, labelled with the commit it was built from.

## 5. Smoke checks (read-only)

```bash
node scripts/release-production.mjs smoke
```

Expect `ok` on every line: `200` with `no-store` for each level, then `401`
for both signed-out routes. Then check in the browser:
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
