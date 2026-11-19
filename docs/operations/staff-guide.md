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

## Board characters (publisher or admin, V1.4)

Each published version needs its own reviewed default characters, which are always shown in 3D on the board.

1. Staff Desk → Board characters. Choose the publication and press **Load rows**.
2. **Suggest from first names** pre-fills a guess from a generic first-name list. It runs only in your browser and is never saved.
   - Rows with unisex or unrecognised names are flagged: decide those yourself.
   - The headscarf character and the wheelchair user are never suggested; choose them only when that is appropriate.
3. Check every row and change anything that looks wrong. Rows left on *Neutral illustration* show a neutral figure.
4. Press **Approve these characters**. Only the chosen character keys are stored.

A new weekly version starts with no characters (nothing carries over by rank), and rolling back restores that version's approved set. A linked student's own opted-in character always replaces the default.

## Verified account links (admin, V1.2)

Staff Desk → Verified account links. Pick a published version, upload a private
`level,rank,username` file, and check every identity in the private preview.
Each row shows the public name, the username and the account status (never the
email: verify usernames against the roster offline), and whether it is new,
changed, or the same as the previous version. Then approve. Each publication needs its own approval, and rollback
restores that version's links. Uploading a header-only file clears the links.
Never link by name alone. A student's own character appears on the board only
after they switch public display on.

## Accounts

The in-app account routes stay **disabled on the hosted site**. Student
accounts are created, recovered and suspended by the authorized operator with
`scripts/student-accounts.mjs`, behind default-off switches. See
`student-accounts.md`. Lost staff authenticator: follow `identity-runbook.md`.
