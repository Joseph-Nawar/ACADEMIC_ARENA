# Runbook: approving verified account links for a publication

For the owner or another AAL2 administrator. A verified link tells the board
"Level L, rank R of this publication is Arena account U". Without one, a
student's saved character never replaces the default character, even when they
have switched public display on. On 2026-11-23 production had **0 links** for
Week 5 (v1), and 21 students had already saved a character and opted in.

**Never guess a link from a name.** Public names repeat, change and get
shortened. Every pairing must come from an identifier that both sources share
(the university student ID or institutional email), compared on your own device.

## 0. Before you start

- The university's written approval to show linked students' chosen characters
  publicly (progress checklist, item 2).
- Your production admin account, with your authenticator app at hand. The link
  screens need a staff session that has passed TOTP (AAL2).
- Two private files, on your own device only:
  1. **The ranking source** for this publication: the official Week 5 file that
     the published `level,rank,public_name` CSV was made from, including each
     ranked student's student ID or institutional email.
  2. **The private roster** used to provision accounts. It maps each student's ID
     or email to their Arena username.
- Work offline in a spreadsheet you don't sync to the cloud. The finished file
  pairs usernames with ranks, which is private.

## 1. Build `level,rank,username` (offline)

### 1a. With the offline tool (recommended)

`scripts/build-link-csv.mjs` runs only on your device and makes no network
calls. It joins rows **only** on the identifier you choose:
- `--key email`: the institutional email;
- `--key roster-ref`: the university reference in the roster's `roster_ref`
  column, e.g. the student number.

It rejects:
- a student who appears at two positions;
- a position that appears twice;
- an identifier that matches more than one roster row;
- roster rows marked `eligible=no`;
- rows with no identifier;
- student numbers a spreadsheet rewrote as a number (`2.02E+11`, `20230112345.0`).
  In the roster these stop the run. Export that column as text.

It reports each of these by level and rank only, never printing an
identifier, name, email or username. It also lists every one of the 30 board
positions the source doesn't cover. It refuses files inside any git repository
or cloud-synced folder (iCloud Drive, Dropbox, OneDrive, Google Drive) and
never overwrites a file. If macOS syncs your Desktop or Documents folder to
iCloud, don't use those folders either: the tool can't always detect that. It writes the result with owner-only
permissions. It approves nothing.

1. In the workbook, **Save as CSV** to a private folder outside the
   repository. Keep one header row and the level, rank and identifier columns.
   Check that student numbers kept their leading zeros.
2. Also have ready:
   - the roster you provisioned from (`roster_ref,email,username,eligible`);
   - the approved `level,rank,public_name` file you published.
3. Run it with your own column names. Use only the key the ranking source
   really has:

```bash
node scripts/build-link-csv.mjs \
  --source ~/Private/arena/week5-source.csv \
  --roster ~/Private/arena/roster.csv \
  --key roster-ref --source-key-column "Student ID" \
  --source-level-column "Level" --source-rank-column "Rank" \
  --published ~/Private/arena/week5-published.csv --source-name-column "Student Name" \
  --out ~/Private/arena/week5-links.csv
```

   - `--published` with `--source-name-column` is required, and is a
     **cross-check only**: it can remove rows, never match them. Arena usernames
     are opaque, so the Staff Desk preview can't show you that the source was a
     different version of the ranking. If the source has no name column, pass
     `--no-published-check` and compare level and rank by hand. A
     row whose source name doesn't match the published name is left out, in
     case the source is a different version. Fix the source, or confirm the
     row by hand. Use `--allow-name-mismatch` only after checking each one.
   - Later weeks or additions: add `--current links-vN.csv`, the file from
     *Download current links* in Staff Desk. Current links are kept. If one
     disagrees with a new match, the current link wins and the row is
     reported.
4. Read the summary. Exit code 0 means no problems. 1 means some rows were
   left out, and each is listed by level and rank. Resolve them by checking
   the university records, never by guessing.
5. Continue at step 2 below. The Staff Desk preview is still where you check
   every row before approving.

### 1b. By hand

For each of the 30 published rows (Levels 4, 5, 6 × ranks 1–10):

1. In the ranking source, take the row's `level` and `rank`. Read off the
   **student ID or institutional email**, not the name.
2. Look that same ID or email up in the private roster and copy the **Arena
   username** exactly (lower case).
3. Check that the roster's identity and the ranking source's identity are the
   same person. The public name on the published board is only a sanity check.
   If anything disagrees, or the student has no account, **leave the row out**.
   A missing link is safe: that row keeps its default character.
4. Write one line per verified row:

```csv
level,rank,username
4,1,<arena-username>
4,2,<arena-username>
5,6,<arena-username>
```

Rules the upload enforces:
- exactly this header;
- at most 30 rows;
- each position and each username at most once;
- usernames only: no names, emails or student numbers;
- every username must be an existing student account.

Linking a student who has not opted in is harmless. Nothing shows until they
switch public display on, and they then appear without another approval.

Optional but recommended: have a second staff member repeat step 1–3 for a
handful of rows and compare.

## 2. Keep the links that are already approved

**Approving replaces the entire link set of the publication.** Any current link
missing from your file is deleted.

- Staff Desk → **Verified account links** → choose the publication (v1 · Week 5).
- The **Currently approved (N)** list shows what exists now.
  - If N is 0 (production Week 5 today), your new file is the whole set.
  - If N > 0, select **Download current links (CSV)**. Add your new rows to that
    file and upload the combined file. Don't start from an empty file.
- To correct one row, change only that line in the downloaded file.

> Before Release A is deployed, production's Staff Desk has no current-links
> list, download or "Will be removed" check. With 0 links today, the first
> upload removes nothing. For any later change before that release, ask for a
> read-only count first (step 5).

## 3. Preview (nothing changes yet)

Choose the file and select **Preview links**. For every line, check that:
- the level, rank and **public name** match the published Week 5 board;
- the username is the one you verified in step 1;
- the account status is `active`. A suspended account is linked but never shown;
- **Will be removed** is empty, unless you deliberately dropped those rows.

If a line shows *changed since previous version*, the same account held a
different row before. Check it again.

## 4. Approve with staff MFA

Select **Approve these links**. The confirmation says the current set will be
replaced, and how many links would be removed. The panel only appears after
your TOTP check, and the server refuses the approval from any session below
AAL2. The result line says how many links were approved,
and the current list reloads. The approval is audited as
`leaderboard.links_approved` with `v<version>-n<count>`.

## 5. Verify (read-only)

Aggregate counts only, from your terminal:

```bash
node scripts/hosted-sql.mjs jhukafyrdredfkzyzggw query "with cur as (select id from public.published_leaderboard_snapshots where is_current and revoked_at is null) select (select count(*) from app_private.published_level_row_links l join cur on l.snapshot_id = cur.id) as links_current, (select count(*) from app_private.published_level_row_links l join cur on l.snapshot_id = cur.id join app_private.accounts a on a.id = l.account_id and a.status = 'active' join public.student_avatar_configs c on c.account_id = l.account_id and c.show_on_leaderboard) as expected_public"
```

Then open the site in a **private window** (signed out). Exactly
`expected_public` rows show a student's own character, with their style,
backdrop and sticker, and every other row keeps its default. Linked students who
open My Character see **PUBLIC NOW**.

## 6. Mistakes and later weeks

- **Wrong link:** download the current links, fix or delete that line, upload
  and approve the full file again. It takes effect on the next page load.
- **Remove all links of a publication:** upload a file with only the header.
- **A new week:** every publication needs its own links, and nothing carries
  over. The preview marks rows where the same account held the same name last
  week (*same as previous version*). That is a hint, not verification, so check
  each row as in step 1. Rolling back to an older week restores that week's
  links.
- **A student asks to be hidden:** they can switch public display off
  themselves. Suspension also hides them at once.
- **Afterwards:** delete the working spreadsheet and the downloaded CSV, or keep
  them only in your encrypted roster store. Never email, chat, upload or commit
  them.
