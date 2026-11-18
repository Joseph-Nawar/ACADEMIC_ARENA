# Deployment status — 18 November 2026 (V1 level-only release)

## URLs

| Environment | URL | Pages project | Supabase project |
|---|---|---|---|
| Production | https://academic-arena.pages.dev | `academic-arena` | `academic-arena-prod` (`jhukafyrdredfkzyzggw`, eu-west-1) |
| Staging (fictional only) | https://academic-arena-staging.pages.dev | `academic-arena-staging` | `academic-arena-staging` (`cynfnxlbmthjxgivllkg`, eu-central-1) |

Both run the `npm run build:production` output with Pages Functions. Each
project has its own 6 encrypted settings, loaded with
`scripts/configure-pages-secrets.sh`. Preview deployments get no secrets and
fail closed.

## Hosted acceptance — 18 Nov 2026

| Check | Staging | Production |
|---|---|---|
| Migrations | 11 applied, latest `202611180001` | 11 applied, latest `202611180001` |
| Table owner, lifecycle gate, pg_cron jobs | postgres, **off**, 2 | postgres, **off**, 2 |
| Accounts | 1 admin (onboarded) | none, no admin yet |
| Published data | 2 fictional versions, **withdrawn** (0 current) | none (0 versions, 0 rows) |
| Anonymous level API (`?level=4/5/6`) | 200, empty | 200, empty, `private, no-store` |
| Bad level/extra params, legacy catalog | 400 / 404 | 400 / 404 |
| Unknown-user login; cross-origin login | 401 generic; 403 | 401 generic; 403 |
| Staff/student routes anonymous | 401 | 401 |
| Keys, Supabase URLs, fictional records in served assets | none | none (only hidden demo-mode strings) |

**Staging admin**
- The audit trail shows bootstrap, temporary password changed, TOTP enrolled and verified.
- A browser-pane session reported role admin, AAL2, nothing pending.

**Staging workflow (fictional data, Staff Desk UI)**
- Rejected uploads: extra metric column, 29 rows, duplicate rank, and markup. No draft was created and nothing went public.
- Valid upload: the preview listed 30 additions. Version 1 published. Each level showed 10 rows in upload order with only allowlisted fields. The page showed "Week 5 · Quiz Leaderboard", the podium with crown, and ranks 04–10.
- Version 2: the preview listed exactly one changed name. All levels switched together.
- Rollback to version 1, then withdrawal: all boards emptied.
- The audit trail records draft, publish, draft, publish, rolled_back, withdrawn.

**Fixed during acceptance (PR #9)**
- The About page copy wrongly called the site a fictional prototype.
- An open page kept showing standings that had been withdrawn or replaced until it was reloaded.

## V1 level-only release (18 Nov 2026)

- PR #7 was merged as `b5921df`. Both Pages projects are deployed from it.
- Public page: LEVEL CHAMPIONS · Quiz Leaderboard · Level 4/5/6 tabs (default
  Level 4). There are no semester, cohort, or module controls. The staging host
  shows a "STAGING · FICTIONAL TEST DATA" stamp; production does not.
- API: `GET /api/public/leaderboards?level=4|5|6`.
  - Any other level or extra parameter returns 400.
  - The legacy `/api/public/catalog` route was removed and returns 404.
  - Hosted reads return 503 until the database is migrated.
- Checked in the browser on both hosts at 390px: no horizontal overflow, the
  level tabs work, and the empty/unavailable states are honest.
- Migration `202611180001_level_only_leaderboards.sql` is applied to both hosted databases (owner-run, 18 Nov).
- The real Week 5 CSV passes the importer locally (30 rows, 10/10/10). It has
  not been uploaded anywhere. Publishing it needs the university's written
  disclosure approval and a verified staff account.

## Hosted checks performed (17 Nov 2026)

| Check | Staging | Production |
|---|---|---|
| Home page 200, production mode, no demo stamp, no staff nav | ✅ | ✅ (browser, desktop + 390px, no horizontal overflow) |
| Data APIs fail closed with JSON 503 (database not yet migrated) | ✅ | ✅; UI shows "temporarily unavailable", never demo data |
| `/api/auth/session` anonymous → `{"authenticated":false}` | ✅ | ✅ |
| Staff routes anonymous → 401; account lifecycle route → 401/404 | ✅ | ✅ |
| Login with cross-origin or missing `Origin` → 403 | ✅ | — |
| Unknown `/api/*` → JSON 404 (fixed during deployment) | ✅ | ✅ |
| API headers `private, no-store`, `Vary: Cookie`, nosniff, `X-Frame-Options: DENY` | ✅ | ✅ |
| Page headers: CSP `self` only, HSTS, `X-Robots-Tag: noindex`, JS/CSS `no-cache` | ✅ | ✅ |
| No Supabase URL, project ref, or key in the static bundle or served assets | ✅ | ✅ |
| Preview deployment of the production project (no secrets) fails closed (503) | — | ✅ (preview deleted afterwards) |

## Blocked: database migrations

This machine's network resets the Postgres protocol to Supabase's pooler
(`ECONNRESET` during the TLS handshake), and the direct database host is
IPv6-only. So `supabase db push` cannot run from here. The HTTPS Management API
works, and `scripts/hosted-sql.mjs` applies the committed migrations through it
(never the seed), recording `supabase_migrations` history. It needs the owner's
CLI login from the macOS keychain, which only the owner may approve. See the
owner checklist in `docs/progress.md`.

Until the migrations run, both sites stay in the fail-closed "temporarily
unavailable" state. No redeploy is needed afterwards.

## Features

**Enabled (after migrations):**
- Public leaderboard and Campus Wins pages, with empty states until something
  is approved.
- Staff sign-in with mandatory TOTP for the bootstrapped administrator.
- Ranking upload, preview, publish, rollback, and withdraw.
- Campus Wins moderation.
- Admin-set public names.

**Disabled on hosted sites:**
- Student provisioning, password recovery, suspension, and in-app staff MFA
  reset. The routes return 403 because `ENVIRONMENT=production`, and the
  database lifecycle gate is off. This awaits hosted verification and
  university approval.
- As a result, students cannot sign in, submit Campus Wins, or react on hosted
  sites yet.
- No real student data or rankings will be uploaded until the university
  approves their external processing and public display.
- Production will not show fictional rankings.
