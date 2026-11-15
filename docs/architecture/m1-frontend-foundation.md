# Milestone 1 frontend foundation

- **Status:** Approved for fictional-data development on 15 November 2026.
- **Scope:** Static Cloudflare Pages package, frontend data boundary, local preview, CI, and documentation. No backend account implementation or public deployment.

## Intent

Prepare the approved V6 interface for a repeatable Cloudflare Pages build. Keep the existing vanilla HTML, CSS, JavaScript, artwork, layout, and interactions. A local preview may display clearly marked fictional fixtures. A production package must exclude those fixtures, begin with no student identities in its HTML, and show an unavailable or empty state until an approved backend provides published data.

## Approaches considered

1. **Direct browser-to-Supabase client.** Smallest code path, but it exposes Supabase Auth user data and access-token claims to the authenticated browser.
2. **Same-origin backend-for-frontend (BFF).** The browser calls only same-origin routes. The BFF resolves usernames, talks to Supabase Auth and Postgres, and returns a minimal session response. Supabase tokens and username-to-email mappings remain server-side. This is the selected Milestone 2 integration boundary.
3. **Custom username/password authentication.** Avoids the email identifier constraint but would create password, session, reset, and MFA code that the university would have to maintain and audit. It is not selected.

## Authentication privacy finding

Supabase documents that its Auth user object contains the user email, and the JWT claims reference lists email as a required access-token claim. A browser Supabase Auth client therefore does not keep an institutional email private from the authenticated client. Username resolution on the server alone does not change that response shape.

Milestone 2 must use a same-origin BFF and an opaque HttpOnly session cookie. The BFF must keep Supabase access and refresh tokens outside browser-readable responses and return only an allowlisted session summary: authenticated state, role, and first-password-change requirement. Do not include names in session state. No browser Supabase SDK or direct Supabase Auth call is part of Milestone 1. A service-role credential must never enter a Pages bundle.

The provider identity mapping will be tested only with local, fictional identities after the BFF exists. A local identity must not be marked as a verified institutional email. Actual provider credentials, institutional emails, and real accounts remain outside this milestone.

References: [Supabase Auth user attributes](https://supabase.com/docs/guides/auth/users), [JWT claims reference](https://supabase.com/docs/guides/auth/jwt-fields), [custom access token hook required claims](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).

## Build and data modes

- Node 24 and a committed npm lockfile provide the build and local Pages preview tooling.
- The build copies only the static UI and required artwork into dist. It excludes FastAPI, local databases, sample CSVs, and the pilot-specific server adapter.
- Demo builds add one fictional fixture file and a runtime mode marker. Production builds exclude the fixture directory and set mode to production. The source default is production/unavailable.
- The browser data layer accepts an explicit mode. In demo mode it reads the fixture and uses browser-local mock interactions. In production mode it calls same-origin API routes and never falls back to demo data.
- If the backend is absent or returns no approved publication, public pages show loading, empty, or unavailable states and never render fictional names as rankings.
- Static production responses expose only allowlisted public board fields and approved Campus Wins templates. Private IDs, emails, grades, Academic Scores, attendance records, account mappings, draft posts, credentials, and moderation data are excluded.

## Frontend contract

The data-access boundary exposes public catalog and leaderboard reads, published Campus Wins reads, authentication session/login/logout/password-change calls, reading and updating the signed-in account's avatar, achievement submission, reaction toggle, staff leaderboard publication, staff moderation, and staff-only student provisioning. Student writes identify the owner through the server session; callers do not submit account IDs, roles, public names, or ranking fields.

Public board rows contain only position, approved public name, approved avatar key, and avatar family. Public Campus Wins rows contain only post key, approved author name, avatar key/family, approved template key, publication time, and the three aggregate reaction counts. Moderation state, author identity keys, reaction identities, and arbitrary text are not part of public response types.

The production adapter uses same-origin routes under /api. In particular, authentication uses POST /api/auth/login and GET /api/auth/session; avatar and achievement writes are scoped to the current session; public leaderboard reads carry level, semester, cohort, board kind, and module filters; staff publication and moderation use separate staff routes. Route authorization, CSRF/origin defenses, rate limits, RLS, MFA, and session revocation are server responsibilities in Milestones 2 and 3. A frontend response allowlist cannot sanitize data that a BFF already sent over the network; the BFF must enforce its response allowlist before sending.

## Security and caching

Cloudflare Pages receives a _headers file with a restrictive same-origin Content Security Policy, frame and MIME protections, referrer and permissions policies, HTTPS transport protection, and conservative revalidation for un-fingerprinted assets. Inline scripts, inline styles, external fonts, and external data APIs are not required. Existing style attributes are represented by allowlisted data attributes and CSS selectors so the policy does not need inline-style exceptions. The build also excludes unused legacy photos and the original artwork source sheet.

HTML and un-hashed assets are revalidated rather than cached for long periods. Demo fixtures are no-store and exist only in demo output. Any future Pages Function response must set its own security headers because Pages _headers does not apply to Function responses. This follows [Cloudflare Pages header behavior](https://developers.cloudflare.com/pages/configuration/headers/).

## Verification

Node's built-in test runner checks the build modes, production asset exclusions, public-response validation, auth response shape, generic login errors, filter encoding, unavailable behavior, and no inline scripts/styles or secret-shaped values. Playwright exercises desktop and 390-pixel mobile layouts against local Wrangler Pages preview, including every leaderboard filter, both avatar families, customization, Campus Wins filters and reactions, production-unavailable behavior, CSP/cache headers, stale-response ordering, and the crown position against visible image pixels. The existing FastAPI smoke suite remains in CI with its missing test client dependency pinned.

## Out of scope and next decisions

Milestone 1 does not create a Cloudflare or Supabase project, implement authentication or staff APIs, define database migrations/RLS, import real identities, publish real rankings, or deploy publicly. Before Milestone 2 uses actual institutional emails, authorized university personnel must approve their external processing in Supabase. The BFF session store, server-side rate-limit storage, and staff account recovery details must be selected and tested before using real accounts.
