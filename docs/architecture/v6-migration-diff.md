# V6-to-V1 migration diff

- **Status:** Updated during M1; frontend foundation implemented on `m1/pages-foundation`, pending independent review.
- **Reviewed:** 15 November 2026

| V6 component | Keep as-is or preserve | V1 destination / required change |
| --- | --- | --- |
| `index.html`, `assets/app.css`, `assets/app.js` | Preserve the approved structure, visual identity, filters, comic podium, crown, 2D and 3D character families, avatar studio, Campus Wins, and responsive layout. | M1 packages the vanilla frontend for Pages, marks demo mode explicitly, renders public data via a provider contract, and fails closed with loading/empty/unavailable states. |
| `assets/characters/`, other artwork, V6 screenshots | Preserve the supplied character families and reference screenshots. | M1 serves the needed character artwork and draft EUE wordmark; the unused legacy photos and source sheet are excluded from the Pages bundle. Do not replace the draft EUE wordmark until the official approved asset is supplied. |
| `assets/data-access.js` and `assets/server-adapter.js` | Preserve useful validation and API-boundary concepts. | M1 adds same-origin public/auth/student/staff contract methods and excludes the FastAPI-specific adapter from Pages builds. M2+ must implement server routes and authorization before production data can appear. |
| `arena/app.py` | Preserve domain rules worth carrying forward: level/semester bounds, board-key validation, top-ten response, avatar allowlist, first-password-change gate, origin/CSRF checks, moderation states, and restricted public fields. | Do not deploy the long-running FastAPI app unchanged. Move authorized server operations to a small Worker/Pages Function or Supabase Edge Function. Revalidate rules and ownership at the server boundary. |
| `arena/security.py` | Keep Argon2id settings and the current implementation as an audit reference only. | Conditional Supabase architecture is approved for fictional development. Do not port custom session code to Workers. M2 needs a same-origin BFF because Supabase user objects and JWTs contain email; real email processing still needs explicit university authorization. |
| `arena/db.py` | Keep its entity outline as a reference. | Replace SQLite and `create_all` with checked-in PostgreSQL migrations. Enable RLS on every exposed table; add explicit grants, private mappings, audit events, publication versions, and role-aware policies. |
| `arena/cli.py` CSV import | Preserve the exact validation rules as reference input checks. The private `account_username` field is not returned by public API. | Add staff CSV upload, validation/preview, completeness checks, versioned candidate, atomic publication, retirement of omitted boards, rollback, and urgent unpublish. Keep raw academic files offline and out of Git/logs. |
| `arena/cli.py` account provisioning | Preserve as a reference for staff-issued accounts and one-time initial-password semantics. | Replace with a staff interface and approved identity provider. Add suspension/reset, session revocation, MFA enrollment/recovery, and audit history. Do not allow student role/name/rank/account-link changes. |
| Campus Wins form and API | Preserve the visual feed, approved reactions, and no-comment layout. | M1 removes free text from the frontend and limits it to approved template types. M3 must validate templates on the server, enforce pending/weekly limits, and implement staff approve/reject/hide/remove plus atomic reactions and rate limits. |
| `tests/smoke_api.py` | Preserve as baseline behavior evidence. | M1 pins the missing test client dependency and adds local browser, build, UI contract, and secret-scan checks. M2/M3 add RLS, ownership, suspension/revocation, publication retirement/rollback, and server limits tests. |
| `.env.example` and `.gitignore` | Keep example credentials fake and local-only; current ignore file excludes env files, databases, logs, and non-example data. | Add separate Pages/Supabase local config examples, strict secret checks, and CI settings. Never place production values or private CSV/backup files in Git. |

## Baseline evidence

- The supplied archive contains the files listed above and six desktop/mobile screenshots.
- Source archive SHA-256: `0216834af692a43d2e3f33f196b09171c324002f51cc0bd26e429419f7cf39e5`.
- `tests/smoke_api.py` passed against a temporary SQLite database after installing the M0 runtime requirements plus `httpx2` into a temporary Python 3.12 environment. M1 declares and pins the missing test client dependency for fresh CI environments.
- No real identities, grades, scores, attendance, public deployments, Supabase project, Cloudflare project, or GitHub Actions workflow were used for this audit.
- The screenshots were visually inspected as reference images; this was not a fresh browser render or accessibility audit.

## Highest-priority migration risks

1. **Addressed in M1 frontend:** the production build excludes demo fixtures and fails closed when the same-origin API is unavailable.
2. V6’s offline CSV importer only replaces boards included in an import, so omitted boards may remain published. V1 must validate and publish the complete snapshot atomically.
3. Student authentication/BFF, password recovery, staff MFA, Postgres migrations/RLS, distributed rate limits, account operations, audit history, backups, and quota recovery remain future work.
4. **Addressed in M1 frontend only:** Campus Wins no longer accepts free text. Server-side weekly/pending caps and staff moderation remain future work.
5. The current account and session implementation is a pilot, not an approved production identity system.
