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
2. Choose the Week 5 publication. The earning period is suggested from the
   release, for example `2026-27:week-5`. Confirm or edit it. **Use the same
   key for every correction or rollback of that week.**
3. Click **PREVIEW REWARDS**. It shows counts only:
   - new grants per collection;
   - already granted, previously revoked, and what *reconcile* would revoke;
   - rows without a verified link, and inactive accounts.
4. With `cosmetic_rewards` off, the panel says nothing can be granted and the
   buttons stay disabled. That is the expected state until approval.

Production note (2026-11-23): Week 5 had 0 approved links, so the preview
would show 0 eligible students until links are approved
(`verified-links-runbook.md`).

## Grant (after approval)

1. The owner switches `cosmetic_rewards` on.
2. Preview again, then click **GRANT REWARDS**. Granting is idempotent: a
   retry, a re-publication or a rollback of the same period grants nothing
   twice. A publication cannot be processed under a second period key
   (`period_conflict`).
3. Students see an unlock celebration on their next visit to My Character.

## Corrections

- **Corrected publication of the same week:** publish it, approve its links,
  preview with the **same** period key, then click **RECONCILE (CORRECTION)**.
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
