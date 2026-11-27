# Verified cosmetic rewards: owner and staff runbook (Release B2)

Nothing in this runbook has run against production. Each production step
needs the owner's explicit approval:

- migration `202611270001`;
- the deployment;
- switching `character_studio_v2` or `cosmetic_rewards` on;
- granting any real reward.

## What earns what

Only verified results count. Eligibility comes from the **staff-verified
account links** of a **published** level-only publication. Names,
unverified rows and avatar public-display consent play no part, so a student
can keep their character private and still earn.

| Verified finish (per level) | Collections granted |
|---|---|
| 1st | Elite + Podium + Champion |
| 2nd–3rd | Elite + Podium |
| 4th–10th | Elite |

Rewards are permanent once earned. A later drop in rank never removes them.
They are revoked only when the results of that same period are corrected.
Revocation is audited, and anything the student was wearing falls back to a
free item.

## Switches (database owner only, all off by default)

```bash
node scripts/student-accounts.mjs features --target local
```

```bash
node scripts/student-accounts.mjs features --target local --set character_studio_v2=on
```

```bash
node scripts/student-accounts.mjs features --target local --set cosmetic_rewards=on
```

On production, `--target <ref>` with `=on` also needs `--confirm-production`.
That is for after written approval only.

- `character_studio_v2`: students can save custom looks, and public pages show
  them. With it off, the board falls back to each student's classic look, or
  to the reviewed default.
- `cosmetic_rewards`: allows granting. Previews work while it is off.

## Preview the Week 5 grants (no grant)

This needs the migration on the target database and an AAL2 administrator.

1. Open **Staff Desk → Verified rewards**.
2. Choose the Week 5 publication. The earning period is filled in from the
   publication's academic year and label (`2026-27:week-5`). A **new** period
   can only use that canonical key, so typos and formatting variants are
   refused. Corrections and replacements of the same week must use the
   existing period; a replacement whose links match an existing period is
   recognised and refused under a new key.
3. Click **PREVIEW REWARDS**. It shows counts only:
   - new grants per collection;
   - already granted, previously revoked, and what *reconcile* would revoke;
   - rows without a verified link, and inactive accounts.
4. With `cosmetic_rewards` off, the panel says nothing can be granted and the
   buttons stay disabled. That is the expected state until approval.

**Verified production state (read-only aggregates, 2026-11-27):**

- The live publication is version 1, release label "week 5", academic year 2026-27.
- It has 30 verified account links to 30 distinct active student accounts (none suspended, none non-student).
- Release A shows 9 personalized public characters.
- Expected Week 5 preview (canonical period key `2026-27:week-5`): 30 eligible students; Elite 30, Podium 9, Champion 3; 42 entitlements in total.

These are expected counts, not an authorization to grant.

## Grant (after approval)

1. The owner switches `cosmetic_rewards` on.
2. Preview again, then click **GRANT REWARDS** and confirm the exact number
   of changes shown. Only the **live** publication can be processed. If
   anything changed since the preview (links, publication, other grants),
   nothing happens (`preview_out_of_date`); preview again. Granting is
   idempotent: a retry, a re-publication or a rollback of the same period
   grants nothing twice.
3. Students see an unlock celebration on their next visit to My Character.

## Corrections

- **Corrected publication of the same week:** publish it, approve its
  **complete** links, preview with the **same** period key, then click
  **RECONCILE (CORRECTION)**. The preview lists the revocations, the affected
  students and the worn items that will fall back. You must type the
  revocation count to confirm. Reconcile is refused for a version with fewer
  verified links than an earlier version of the period (incomplete linking
  cannot cause mass revocation).
- **Suspended students** keep everything their verified results earned, and
  are still granted. Suspension only hides them from public pages.
  Reconcile grants what the correction adds and revokes what it no longer
  supports (`result_corrected`). Worn revoked items fall back to free ones,
  and the student's open studio is refused a stale save.
- **A single grant made in error** (for example a link verified wrongly), as
  owner SQL. Allowed reasons are `result_corrected`, `link_corrected` and
  `granted_in_error`:

  ```sql
  select public.revoke_cosmetic_entitlement('<username>', 'elite', '2026-27:week-5', 'link_corrected');
  ```

  This must run in an AAL2 admin context; through the SQL editor, use the
  admin's session or ask for a Staff Desk control.
- History: Staff Desk lists each period's versions, active counts per
  collection and revocations. `app_private.reward_events` is append-only.

## Privacy

- The browser receives only the student's own collections and grant labels
  (for example "Week 5").
- Staff previews are aggregates.
- Public APIs carry only the allowlisted look, never accounts, links,
  revisions, inventories or grades.
