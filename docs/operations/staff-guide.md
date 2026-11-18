# Staff guide

## Signing in

Use the staff-issued username and password (**SIGN IN** at the top right).
The first time, change the temporary password, then set up an authenticator
app (Google Authenticator, Microsoft Authenticator, 1Password, …) with the
setup key shown once. After that, every sign-in asks for the six-digit code.
The **Staff Desk** appears in the menu only after this verification.

Roles: **publisher** (rankings), **moderator** (Campus Wins), **admin** (both,
plus approved public names).

## Publishing rankings (V1: Level 4 / 5 / 6 · Top 10)

1. Prepare a CSV with exactly this header and 30 rows (ten ranks for each of
   Levels 4, 5, and 6). Copy the empty template from `data/ranking-upload.template.csv`:
   `level,rank,public_name`
   - `rank` is 1–10 per level, with no gaps or duplicates. Each name may appear only once per level.
   - `public_name` is the university-approved display name. Spelling and
     capitalization are kept exactly; extra spaces are trimmed.
   - **Never include** scores, quiz counts, attendance, student IDs, emails, or
     extra columns. The upload is rejected if you do.
   - Two students with the same name in one level must be disambiguated
     (for example with an approved initial). Names with hidden characters,
     look-alike letters from mixed alphabets, or fullwidth forms are rejected.
   - The site does not recalculate rankings. Ranks are shown exactly as uploaded.
   - Keep real files on your own device. Never put them in the repository or
     on the staging site.
2. Staff Desk → enter the academic year (e.g. `2026-27`) and the release label
   (e.g. `Week 5`) → choose the file → **Validate & preview**. Fix any listed
   line errors and upload again.
3. Read the preview. It lists, by level and rank, each name that is new,
   changed, or removed compared with the live version.
4. Click **Publish this version**. All three levels go live together.
   Characters on the board are assigned by rank only, never from a name.

Each upload replaces the previous unpublished draft. Only one draft is kept at a
time, so coordinate if two publishers are working.

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
