# Release B (Character Studio V2): production rollout (owner)

Release B adds one migration, `202611270001_release_b_character_v2_and_rewards.sql`.
It is additive and creates no student data:

- V2 columns next to the Classic look. Existing rows stay `classic` and keep
  their consent.
- The generated catalogue, entitlements, earning periods and append-only
  reward history.
- Public projections `public_level_leaderboard_v4` and `public_campus_wins_v2`.
- Two new owner-only switches, **both off**: `character_studio_v2` and
  `cosmetic_rewards`.
- **Campus Wins privacy:** browser roles lose direct read access to
  `campus_wins_public`.

Nothing is visible to students until you switch something on. Run these steps
on the internal disk, not `/Volumes/JOSEPH`, and stop at the first line that
doesn't match.

## 0. Approve and merge

1. Review the PR, the staging acceptance results and screenshots, and CI on
   the final head.
2. Note the reviewed **tree id** (`git rev-parse <head>^{tree}`, from the
   release report and the PR comment).
3. Merge with a normal merge commit, and wait for CI on the merge commit.

## 1. Fresh checkout and verification (no production change)

```bash
mkdir -p ~/Developer && cd ~/Developer && git clone https://github.com/Joseph-Nawar/ACADEMIC_ARENA.git aa-release-b && cd aa-release-b
npm ci
node scripts/release-production.mjs verify --tree <TREE>
npm test && npm run check:security
```

## 2. Backup (required before this migration)

```bash
npx supabase link --project-ref jhukafyrdredfkzyzggw
node scripts/backup-preflight.mjs jhukafyrdredfkzyzggw
scripts/db-backup.sh export linked /secure/offsite/academic-arena-$(date +%F).aabk
npx supabase link --project-ref cynfnxlbmthjxgivllkg
```

Record the counts from `backup-restore.md` §Restore step 4.

## 3. Migration

The app can stay on Release A during this step: everything Release A reads
keeps working (see "Compatibility"), except its Campus Wins feed, which fails
closed. Production has 0 Campus Wins posts.

```bash
node scripts/release-production.mjs migrate --tree <TREE> --expect 202611270001_release_b_character_v2_and_rewards.sql
```

Then check, read-only:

```bash
node scripts/hosted-sql.mjs jhukafyrdredfkzyzggw query "select (select character_studio_v2 or cosmetic_rewards from app_private.student_feature_controls) as new_switches_on, (select count(*) from app_private.character_v2_values) as catalogue, (select count(*) from public.student_avatar_configs where active_look <> 'classic' or v2_config is not null) as converted, has_table_privilege('anon','public.campus_wins_public','select') as anon_reads_wins, has_function_privilege('anon','public.public_campus_wins_v2(text[])','execute') as anon_projection"
```

Expect:

| Column | Value |
|---|---|
| `new_switches_on` | false |
| `catalogue` | 339 |
| `converted` | 0 |
| `anon_reads_wins` | false |
| `anon_projection` | true |

## 4. Deploy Pages

```bash
node scripts/release-production.mjs deploy --tree <TREE>
node scripts/release-production.mjs smoke
```

Every smoke line must read `ok`:

- levels 4–6: 200 with no-store;
- `character_studio_v2 off`;
- the Campus Wins feed: 200;
- `/api/me/avatar`, `/api/me/character`, `/api/staff/rewards` and staff
  links: 401 when signed out.

In a private window the Week 5 boards look exactly as before: the 9
personalized Classic characters plus the reviewed defaults. My Character
still shows only the Classic studio.

## 5. Switch on, one at a time (each needs your explicit approval)

1. **Custom characters:** students can save V2 looks, and the board shows them.

   ```bash
   node scripts/student-accounts.mjs features --target jhukafyrdredfkzyzggw --set character_studio_v2=on --confirm-production
   ```

   Check: a pilot student keeps their Classic look until they save a custom
   one, and a signed-out window shows the custom look on the next load.
2. **Week 5 rewards preview (grants nothing):** Staff Desk → Verified rewards
   → the live Week 5 publication → period `2026-27:week-5` → PREVIEW.
   - Expected: 30 eligible students; Elite 30, Podium 9, Champion 3; 42
     changes; no blockers.
   - If anything differs, stop and investigate. Do not grant.
3. **Grant (only after the reward policy is approved):**

   ```bash
   node scripts/student-accounts.mjs features --target jhukafyrdredfkzyzggw --set cosmetic_rewards=on --confirm-production
   ```

   Then preview again, click GRANT REWARDS and confirm "42 changes".
   Afterwards switch `cosmetic_rewards` back **off** until the next approved
   period; previews keep working while it is off.

## Compatibility and rollback

**Release A app on the Release B schema** (tested 27 Nov: Release A's own
live suite against a database with this migration):

- 46 of 48 tests pass.
- The 2 failures are the intended Campus Wins boundary: Release A's feed
  returns "unavailable" instead of reading the table, and a direct REST read
  of the table is refused.
- Boards, links, defaults, accounts, MFA, saves of Classic looks and sessions
  all work. Release A's V3 board shows each student's Classic look, or the
  reviewed default for students who only have a custom look. It never shows
  an unconsented look.

**Rolling back the app:** Cloudflare → Pages → `academic-arena` → Deployments
→ previous deployment → *Rollback*. Leave the migration in place:

- Campus Wins stays fail-closed, so the consent vulnerability (#25) never
  returns.
- Custom looks and rewards stay stored, unused, for a later redeploy.
- Before rolling back, switch `character_studio_v2` off, so a later
  re-deploy starts from the same state.

**Never restore the old Campus Wins grant** (`grant select on
public.campus_wins_public to anon`) to "fix" a rolled-back feed. That would
expose approval-time snapshots without consent. Redeploy Release B instead.

**Rolling back the database** is not needed for safety. If it is ever
required, write a new corrective migration; never edit or revert an applied
one. Take a backup first.
