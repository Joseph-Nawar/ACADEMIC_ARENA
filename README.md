# Academic Arena — frontend and M2 local foundation

**Status:** M1 is merged. M2 BFF/authentication/database work is a feature-branch review candidate. Local and automated preview only: no hosted provider project, real university identities, real academic records, or public deployment is configured.

Academic Arena preserves the approved vanilla HTML, CSS, JavaScript, and V6 artwork: the illustrated leaderboard and podium, crown, EUE draft identity, level/semester/module filters, Comic Original and separate 3D Cartoon character families, character customization, Campus Wins, and responsive layouts.

## Local development

Requirements: Node.js 24.x and npm. A clean checkout installs the pinned toolchain and tests with:

```bash
npm ci
npm test
npm run build:demo
npm run build:production
```

To preview the fictional demo through Wrangler Pages:

```bash
npm run preview
```

The demo build is explicitly opt-in, reads only `fixtures/demo/academic-arena.json`, and stores character edits and reactions in local browser storage. It is rejected when Cloudflare Pages sets `CF_PAGES`, and the browser enables demo mode only on loopback hosts. Its fictional rankings and posts never become production fallback data.

For an explicit local production-mode preview:

```bash
npm run build:production
npx wrangler pages dev dist --ip 127.0.0.1 --port 8788
```

The production build omits fixtures, the FastAPI adapter, unused legacy photos, and the artwork source sheet. Without a backend, leaderboards and Campus Wins show unavailable states.

## Verification

Install the pinned Chromium binary once to run the local browser flow:

```bash
npx playwright install chromium
npm run test:browser
npm run test:security
npm run check:security
```

The browser smoke starts Wrangler locally and checks demo interactions at desktop width, demo disclosure/layout at 390 pixels, and production unavailable states at desktop and mobile sizes. It does not publish or deploy anything.

## Milestone 2 local provider tests

The pinned Supabase CLI native runtime runs fictional Auth, Postgres, and PostgREST locally without Docker. GitHub Actions uses automatic runtime selection on its Ubuntu runner, which selects the available Docker engine. Both modes bind to loopback, disable public signup, and use test-created random `*.academic-arena.test` identities. The email-confirmation flag is only applied to ephemeral local test users because local password sign-in requires it; it does not verify any external identity.

```bash
npm run test:m2:local
```

The command refuses to reset an already-running local stack, starts Supabase bound to loopback, applies migrations and fictional seeds, runs pgTAP/RLS assertions and serial live BFF/Auth/PostgREST integration tests, then stops the stack and removes temporary local bindings. The local default is native runtime; CI sets `AA_SUPABASE_RUNTIME=auto` so the CLI uses Docker when available. CLI subprocesses are bounded to five minutes so failed startup or cleanup cannot hang the job indefinitely. The lifecycle RPCs are disabled by default in migrations; only the local fictional seed enables them, and the Pages BFF also requires `ENVIRONMENT=test`. `npm run supabase:start`, `npm run supabase:reset`, and `npm run supabase:stop` are available for manual local inspection. No hosted project link or credentials are needed.

The legacy FastAPI pilot remains a reference for domain behavior; it is not deployed by Pages. Its baseline smoke test is reproducible with Python 3.12:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt -r requirements-test.txt
python tests/smoke_api.py
```

## Data and authentication boundaries

The browser calls `assets/data-access.js`. Demo mode reads fictional fixtures. Production mode sends public reads and future authenticated actions only to same-origin `/api` routes and fails closed when those routes are not available. It has no Supabase browser SDK, Supabase client key, service-role secret, or account mapping.

The frontend contract covers public catalogs and approved leaderboard rows, approved Campus Wins templates and reactions, username/password sign-in and session state, account-owned character changes, achievement submission, and staff publishing/moderation/provisioning boundaries. M2 implements the same-origin BFF for username/password login, opaque sessions, initial password changes, staff TOTP, and owned avatar reads/writes. Account provisioning/recovery/suspension/MFA-reset routes intentionally reject non-test environments. M3 publication, Campus Wins submissions/moderation/reactions, and production account operations remain unimplemented. A browser allowlist is defense in depth and cannot replace server response filtering, authorization checks, or RLS.

Supabase Auth returns email in its user object and includes email in required access-token claims. Local provider tests confirm this response behavior, so direct browser Supabase Auth is rejected. The same-origin BFF privately resolves usernames, stores provider tokens encrypted on the server, and returns only an opaque HttpOnly cookie plus an allowlisted session summary. Live local Supabase tests cover the Auth lifecycle and RLS; hosted-provider behavior and configuration remain unverified. See [`docs/architecture/m2-auth-database.md`](docs/architecture/m2-auth-database.md) and the [authentication feasibility memo](docs/auth/username-password-feasibility.md).

The conditional Supabase architecture is approved for fictional development. Real institutional emails may be processed by Supabase only after the appropriate university personnel explicitly authorize that processing. This milestone does not authorize those identities, provider credentials, or actual account creation.

## Campus Wins limits

The interface offers only approved milestone templates, with ❤️, 👏, and 🔥 reactions. It has no free-text posts, comments, messaging, public-name editing, or image upload. Demo submissions remain local to the fictional preview; a demo approval button is not a production moderation control.

## Deployment and operations

`npm run build:production` creates the Pages static artifact. `npm run build:demo` is for local preview only and is rejected by the builder on Cloudflare Pages. `_headers` sets restrictive same-origin security headers, a no-index directive, short asset revalidation, and no-store caching for demo fixtures. M2 Pages Functions set their own no-store API headers. No provider secret is part of the static build.

GitHub Actions CI runs checks only; the workflow has read-only repository permissions and no deployment credentials. No public deployment is authorized. See [`docs/roadmap.md`](docs/roadmap.md) for the milestone sequence and remaining launch decisions.

The draft EUE wordmark remains clearly identified as draft artwork. Replace it only when an approved official asset is supplied.

## Legacy pilot files

- `arena/` — FastAPI pilot retained for domain and test reference; do not deploy unchanged.
- `assets/server-adapter.js` — legacy FastAPI adapter excluded from Pages builds.
- `tests/smoke_api.py` — baseline backend behavior check.
- `data/sample-approved-ranks.example.csv` — fictional schema example, ignored by Git; never use real data in development or tests.
