# Staff guide

## Signing in

Use the staff-issued username and password (**SIGN IN** at the top right).
The first time, change the temporary password, then set up an authenticator
app (Google Authenticator, Microsoft Authenticator, 1Password, …) with the
setup key shown once. After that, every sign-in asks for the six-digit code.
The **Staff Desk** appears in the menu only after this verification.

Roles: **publisher** (rankings), **moderator** (Campus Wins), **admin** (both,
plus approved public names).

## Publishing rankings

1. Prepare the CSV from `data/ranking-upload.template.csv`. Columns, exactly in
   this order:
   `level,semester,cohort_key,cohort_label,board_kind,module_key,module_label,rank,public_name,avatar_key,avatar_family`
   - `level` 4/5/6, `semester` 1/2, `board_kind` `semester` or `module`.
   - `cohort_key`/`module_key`: lowercase identifiers (`core`, `cm2005`);
     leave both module columns empty for semester boards.
   - `rank` 1–10, no gaps or duplicates per board; each student once per board.
   - `public_name`: the university-approved display name only.
   - `avatar_key`: omar, mariam, youssef, amara, tariq, habiba2, malek, nour2,
     zein; `avatar_family`: `ink` (Comic) or `cartoon3d` (3D Cartoon).
   - **Never include** grades, scores, attendance, student IDs, emails, or
     extra columns — the upload is rejected.
   - Only include a semester-wide board if it was explicitly provided and
     approved; the site never computes one.
2. Staff Desk → enter the academic year (e.g. `2026-27`) → choose the file →
   **Validate & preview**. Fix any listed line errors and upload again.
3. Read the preview: new boards, changed positions, and boards that **will be
   removed** from public view (any board not in this file disappears).
4. **Publish this version**. The whole file goes live at once.

Each upload replaces the previous unpublished draft (one active draft at a
time; coordinate if two publishers work together).

## Correcting rankings

- **Roll back**: Publication history → *Roll back to this* on a previous version.
- **Withdraw**: *Withdraw live rankings* hides all standings immediately until
  the next publication. Use this for any takedown request, then investigate.

## Campus Wins moderation

Staff Desk → Campus Wins review. *Pending* shows new submissions with the
student's approved public name and template.
- **Approve** publishes it; **Reject** keeps it private.
- *Published* → **Hide** (temporarily remove, reactions kept) or **Remove**
  (permanent, reactions deleted). *Hidden* → **Restore** or **Remove**.
Students see only "awaiting review", "published", "not approved", or "no
longer shown" — never moderator identity or reasons.

Suspending a student does not automatically hide their published posts; hide
them if needed.

## Approved public names (admin)

Students cannot pick their public name. Staff Desk → Approved public names →
student username + the approved display name. A student needs one before they
can share a Campus Win.

## Accounts

Creating students, password recovery, suspension, and staff MFA reset are
**disabled on the hosted site** until hosted verification and university
approval (see `docs/progress.md`). Lost staff authenticator: follow
`identity-runbook.md`.
