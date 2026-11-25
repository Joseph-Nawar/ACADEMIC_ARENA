# Campus Wins and public characters: current behaviour and the V2 proposal

Status: investigation only (2026-11-23). **Release A does not change Campus Wins.**

## Current behaviour (code as of `main` + Release A)

When a moderator **approves** a win, `public.moderate_campus_win`
(`supabase/migrations/202611170001_m3_publication_and_campus_wins.sql`,
around lines 507–535) copies three things from the author's account into the
submission and into the public table `public.campus_wins_public`:
- the approved public name;
- `character_key`;
- `family` (the style).

The public feed (`functions/api/public/campus-wins/index.js`) reads those
stored columns directly.

As a result:

| Behaviour | Effect |
|---|---|
| **Snapshot at first approval** (`coalesce(...)` keeps the first value, even after hide and re-approve) | A student's later character changes never reach their published wins. The board updates on the next load while the win keeps the old look, so one student can appear with two different characters. |
| **Opt-in ignored** | The board needs `show_on_leaderboard`, the `avatar_personalization` switch and a verified link. Campus Wins checks none of them, so a student who switched public display off still has their saved character shown on an approved win. |
| **Default character assigned** | A student who never saved a character is shown as `omar` / `ink` (`coalesce(avatar.character_key, 'omar')`). That attributes a specific human character to someone who did not choose it, against the rule the board follows (no inferred characters; neutral illustration instead). |
| **Backdrop and sticker missing** | Only key and family are stored, so tone and badge are never shown. |
| **Suspension doesn't apply** | Suspending an account doesn't touch `campus_wins_public`, so the post stays with its stored name and character until staff hide or remove it. |
| **Name snapshot** | A later staff-approved public-name change is not reflected either. |

**Production exposure today:** 0 submissions and 0 public posts (read-only
count, 2026-11-23). Student sign-in is on, so students can submit, and the
first approval would create the snapshot described above.

### Interim decision for the owner (until V2)

Pick one. Neither is part of Release A.
1. **Moderator rule:** only approve a win if the author has public display on.
   They can check it themselves in My Character, under *Public display on*.
   Afterwards, hide the win if the student later opts out or is suspended.
2. **Small corrective release (A.1):** in `moderate_campus_win`, refuse to
   publish a character unless the author is opted in, and use a neutral figure
   otherwise. Hide an author's posts on suspension. This needs a migration and
   tests, and the owner's approval.

## Proposal for Character Studio V2: one public character, one consent

**Principle:** a student has at most one *public character*. It appears
wherever their identity is public (podium, ranks 4–10, Campus Wins), always in
its latest saved form, and only while they consent. Otherwise every surface
shows the same neutral figure. Nothing is ever inferred.

1. **Consent**
   - A single switch, *Show my character publicly*, replaces today's
     leaderboard-only wording. The studio lists exactly where it appears.
   - Opting out takes effect everywhere on the next load, with no history kept.
   - The status panel from Release A grows to cover the Campus Wins line:
     public on N wins.
2. **Store parameters, not snapshots**
   - Posts store no appearance. The public feed becomes a projection,
     `public_campus_wins_v2`, that joins post → author (private) →
     `student_avatar_configs` at read time.
   - It shows the author's current allowlisted V2 parameters only when all of
     these hold: the author is active, has opted in, and
     `avatar_personalization` is on.
   - Otherwise it shows the neutral figure. There is no `omar` default.
3. **Lifecycle**
   - The projection also filters out suspended or withdrawn authors, and posts
     staff have hidden.
   - The approved public name is read at the same time, so a staff-approved
     rename shows everywhere.
4. **Same renderer, same rules**
   - The board and Campus Wins call the shared V2 renderer with the same
     allowlisted parameters.
   - One server-side function decides "may this account's character be shown
     publicly?". The board, Campus Wins and the student's status panel all use
     it, so they cannot disagree. This extends the Release A rule that "public"
     is decided by the projection itself.
5. **Moderation**
   - Approving a win approves the template and the author's public name, never
     a look.
   - Looks are built only from allowlisted parameters, so a character change
     needs no re-moderation.
6. **Migration path**
   - Add the projection, and switch the API and frontend to it.
   - Stop reading the stored `avatar_key` / `avatar_family` columns, but keep
     them for one release so a rollback still works. Drop them later in an
     append-only migration.
   - No backfill is needed.
7. **Tests**
   - pgTAP:
     - opt-out, suspension and the switch hide the character on posts;
     - a re-save shows on the next read;
     - there is no default human character;
     - anonymous visitors can read only allowlisted columns.
   - M2: approve a win, change the character, check the feed; opt out, check
     the neutral figure.
   - Browser: the same character on the board and on a win, desktop and
     mobile.
