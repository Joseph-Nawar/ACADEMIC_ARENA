# Deployment status — 17 November 2026

## URLs

| Environment | URL | Pages project | Supabase project |
|---|---|---|---|
| Production | https://academic-arena.pages.dev | `academic-arena` | `academic-arena-prod` (`jhukafyrdredfkzyzggw`, eu-west-1) |
| Staging (fictional only) | https://academic-arena-staging.pages.dev | `academic-arena-staging` | `academic-arena-staging` (`cynfnxlbmthjxgivllkg`, eu-central-1) |

Both run the `npm run build:production` output with Pages Functions. Each
project has its own 6 encrypted settings, loaded with
`scripts/configure-pages-secrets.sh`. Preview deployments get no secrets and
fail closed.

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
