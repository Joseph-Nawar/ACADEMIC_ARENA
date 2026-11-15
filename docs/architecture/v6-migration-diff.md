# V6-to-V1 migration diff

- **Status:** M0 audit; no product code changed.
- **Reviewed:** 15 November 2026

| V6 component | Keep as-is or preserve | V1 destination / required change |
| --- | --- | --- |
| `index.html`, `assets/app.css`, `assets/app.js` | Preserve the approved structure, visual identity, filters, comic podium, crown, 2D and 3D character families, avatar studio, Campus Wins, and responsive layout. | Serve statically from Pages. Make the data mode explicit. Production must not silently use the fictional demo if an API/config request fails. Keep the fictional offline preview for local/staging only. |
| `assets/characters/`, other artwork, V6 screenshots | Preserve the supplied art and screenshot baseline. | Keep all demo assets fictional. Do not replace the draft EUE wordmark until the official approved asset is supplied. Check asset sizes before Pages configuration. |
| `assets/server-adapter.js` | Preserve the useful API boundary concepts and field validation behavior. | Replace the FastAPI-specific endpoint contract with the approved static/public data contract and minimal same-origin functions. Do not return private mapping fields. Add explicit unavailable state and no production demo fallback. |
| `arena/app.py` | Preserve domain rules worth carrying forward: level/semester bounds, board-key validation, top-ten response, avatar allowlist, first-password-change gate, origin/CSRF checks, moderation states, and restricted public fields. | Do not deploy the long-running FastAPI app unchanged. Move authorized server operations to a small Worker/Pages Function or Supabase Edge Function. Revalidate rules and ownership at the server boundary. |
| `arena/security.py` | Keep Argon2id settings and the current implementation as an audit reference only. | Identity choice is pending. Do not port custom session code to Workers. Prefer managed Supabase Auth only if the approved private mapping condition is met and the M2 lifecycle/MFA proof passes. |
| `arena/db.py` | Keep its entity outline as a reference. | Replace SQLite and `create_all` with checked-in PostgreSQL migrations. Enable RLS on every exposed table; add explicit grants, private mappings, audit events, publication versions, and role-aware policies. |
| `arena/cli.py` CSV import | Preserve the exact validation rules as reference input checks. The private `account_username` field is not returned by public API. | Add staff CSV upload, validation/preview, completeness checks, versioned candidate, atomic publication, retirement of omitted boards, rollback, and urgent unpublish. Keep raw academic files offline and out of Git/logs. |
| `arena/cli.py` account provisioning | Preserve as a reference for staff-issued accounts and one-time initial-password semantics. | Replace with a staff interface and approved identity provider. Add suspension/reset, session revocation, MFA enrollment/recovery, and audit history. Do not allow student role/name/rank/account-link changes. |
| Campus Wins form and API | Preserve the visual feed, reactions, approval state, and no-comment layout. | Remove free-text note input and API field, use only approved templates/icons, enforce one pending and one weekly submission server-side, and give staff approve/reject/hide/remove controls. Implement atomic reaction toggle and server rate limits. |
| `tests/smoke_api.py` | Preserve as baseline behavior evidence and improve its test matrix. | Add the required test dependency declaration/lock; add RLS role tests, account ownership, suspension/session invalidation, publication retirement/rollback, rate limits, and no-free-text tests before release. |
| `.env.example` and `.gitignore` | Keep example credentials fake and local-only; current ignore file excludes env files, databases, logs, and non-example data. | Add separate Pages/Supabase local config examples, strict secret checks, and CI settings. Never place production values or private CSV/backup files in Git. |

## Baseline evidence

- The supplied archive contains the files listed above and six desktop/mobile screenshots.
- Source archive SHA-256: `0216834af692a43d2e3f33f196b09171c324002f51cc0bd26e429419f7cf39e5`.
- `tests/smoke_api.py` passed against a temporary SQLite database after installing the declared runtime requirements plus `httpx2` into a temporary Python 3.12 environment. A clean environment using only `requirements.txt` failed first because the installed Starlette TestClient requires `httpx2`, which is not declared in the archive’s requirements.
- No real identities, grades, scores, attendance, public deployments, Supabase project, Cloudflare project, or GitHub Actions workflow were used for this audit.
- The screenshots were visually inspected as reference images; this was not a fresh browser render or accessibility audit.

## Highest-priority migration risks

1. The browser adapter falls back to demo data when the server config is unavailable; remove that behavior from production mode.
2. V6’s offline CSV importer only replaces boards included in an import, so omitted boards may remain published. V1 must validate and publish the complete snapshot atomically.
3. Student authentication, password recovery, staff MFA, Postgres migrations/RLS, distributed rate limits, account operations, audit history, backups, and quota recovery are missing.
4. Campus Wins accepts free text and has no weekly/pending server-side caps. V1 must use fixed templates and server-enforced limits.
5. The current account and session implementation is a pilot, not an approved production identity system.
