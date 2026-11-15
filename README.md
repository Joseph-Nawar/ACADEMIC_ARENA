# Academic Arena V6 — EUE UoL Computer Science

**Status:** Real, executable *local pilot foundation*, **not yet approved or security-audited for a public deployment**.

V6 preserves the director-approved comic-style leaderboard, keeps the crown above the winner, adds stronger EUE identification, adds an independently illustrated **3D Cartoon** family alongside **Comic Original**, and retains **Campus Wins** with reactions and **no comments**.

## Two modes

### A. Visual demo (no installation)

Open `index.html` in a browser, keeping `assets/` alongside it. Fictional student names, fictional positions, local-only avatar editing, and fictional achievements. No server or account sign-in exists in this mode.

### B. Server-backed pilot (real accounts and approved snapshots)

Requirements: Python 3.11+ and a supported environment for `pip`. **Do not expose this development setup to the public internet.**

```bash
cd academic-arena-v6
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export ARENA_ORIGIN=http://localhost:8000
export ARENA_ALLOW_INSECURE_HTTP=1  # LOCAL DEVELOPMENT ONLY
uvicorn arena.app:app --host 127.0.0.1 --port 8000
```

Open http://localhost:8000. Without approved data imports, the public leaderboard shows an unpublished state. The actual backend DOES NOT inject fictional rankings or Campus Wins.

Run the test suite:

```bash
python tests/smoke_api.py
```

### Staff-issued accounts

In a separate terminal, from the same project root and environment:

```bash
python -m arena.cli create-user --username example001 --display-name 'Example Student' --role student
python -m arena.cli create-user --username moderator01 --display-name 'Approved Moderator' --role staff
```

A unique, one-time password is printed **once**. Give it privately to the right student (never put it in frontend code, a publicly accessible spreadsheet, or a repository). On first sign-in, the student MUST change that password before editing characters, posting, or reacting.

### Publishing university-approved leaderboard snapshots

1. Arrange written university approval of the precise public-name/rank disclosures and cohort membership.
2. Export only publication-approved data using the EXACT sample CSV column names. No Academic Scores, grades, email, IDs, or attendance details.
3. For every student's editable avatar, provide `account_username` in the private import file; this binds that approved leaderboard identity to that student's staff-issued account. The username is **not sent to public browsers**.
4. Separate cohorts by `group_key` if the academic opportunities/module selections differ. Use `board_kind=semester` and `board_key=all` for a semester top ten; `board_kind=module` and the approved module code for module top tens. The frontend loads available groups and modules from the approved published catalog.
5. Only after checking the file and explicitly confirming approval:

```bash
python -m arena.cli import-board --csv /secure/private/approved-ranking-snapshot.csv --approved
```

The importer REJECTS unexpected columns including grades, scores, IDs, and emails. Publishing replaces existing entries in each included board. Do not upload the private import CSV to public hosting or git.

### Campus Wins moderation

Authenticated students can submit a predefined achievement type and a short optional message. Submitted posts remain **pending** until approved or rejected by a staff account; a public reader can never approve posts. Staff see a moderation section on the Campus Wins screen when signed in. Reactions are limited to one of heart, clap, or fire per signed-in account and can be toggled. No comments, photo uploads, or arbitrary file uploads exist.

## What is and isn't protected

The pilot stores usernames, public display names/ranking associations, Argon2id password hashes, session-token hashes, avatar selections, achievement submissions and moderation status. **These are still personal/security-relevant data.** It intentionally does NOT store grades, actual Academic Scores, raw attendance, student IDs, emails, or student photographs. Public names and rankings alone may disclose academic standing: university permission is mandatory.

The backend enforces origin checks and CSRF for writes, 24-hour opaque HTTP-only sessions, HTTPS-only cookies outside explicitly configured local development, per-account lockout and per-IP single-process attempt throttling, safe structured avatar choices, public-only published rankings, staff role checks, and server-side post moderation. Password hashing uses Argon2id. These are meaningful controls **but not a formal security audit**.

## Before external deployment — mandatory gates

- Obtain director/IT and privacy-office approval for the precise data published, staff membership, opt-out/corrections, and retention policy.
- Get the university's **official approved EUE logo (SVG/PNG)** and replace the clearly marked draft logo. Current bold EUE text is not a claim that its artwork is official.
- Use an IT-approved HTTPS hostname, protected database, backups, recovery plan, server logs without credentials, and monitored patching.
- Configure `ARENA_ORIGIN=https://your-approved-domain` and **never** set `ARENA_ALLOW_INSECURE_HTTP=1` outside local testing.
- Add reverse-proxy/distributed login rate limiting, content moderation escalation and abuse-reporting/takedown workflow; decide credential-distribution and password-reset procedure.
- Have an independent security review/penetration test, including account ownership, CSRF, XSS, injection, publish permissions, session management, and mobile accessibility.
- Substitute actual semester/module names from the university-approved academic catalog; sample module A/B/C labels are only fictional demo fallbacks.
- Plan versioned database migrations (this pilot creates initial tables but does not include Alembic migrations).

## Files

- `index.html` and `assets/` — V6 public UI and local art
- `assets/app.js`, `assets/server-adapter.js`, `assets/app.css` — frontend and live API connection
- `arena/app.py`, `arena/db.py`, `arena/security.py`, `arena/cli.py` — backend, DB, authentication, restricted publishing
- `data/sample-approved-ranks.example.csv` — purely fictional format example; **do not publish it as a real leaderboard**
- `tests/smoke_api.py` — local automated endpoint/security flow
- `CODEX_HANDOFF.md` — production continuation tasks
