# Academic Arena — Milestone 1 frontend foundation

**Status:** local and automated preview only. No provider project, real university identities, real academic records, or public deployment is configured.

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

The demo is clearly marked, reads only `fixtures/demo/academic-arena.json`, and stores character edits and reactions in local browser storage. Its fictional rankings and posts never become production fallback data.

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

The browser smoke starts Wrangler locally and checks both demo and production modes at desktop and mobile sizes. It does not publish or deploy anything.

The legacy FastAPI pilot remains a reference for domain behavior; it is not deployed by Pages. Its baseline smoke test is reproducible with Python 3.12:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt -r requirements-test.txt
python tests/smoke_api.py
```

## Data and authentication boundaries

The browser calls `assets/data-access.js`. Demo mode reads fictional fixtures. Production mode sends public reads and future authenticated actions only to same-origin `/api` routes and fails closed when those routes are not available. It has no Supabase browser SDK, Supabase client key, service-role secret, or account mapping.

The frontend contract covers public catalogs and approved leaderboard rows, approved Campus Wins templates and reactions, username/password sign-in and session state, account-owned character changes, achievement submission, and staff publishing/moderation/provisioning boundaries. These production endpoints and server authorization are not implemented in Milestone 1. A browser allowlist is defense in depth and cannot replace server response filtering, ownership checks, or RLS.

Supabase Auth returns email in its user object and includes email in required access-token claims. Direct browser Auth would reveal the provider email to the authenticated client. Milestone 2 therefore requires a same-origin backend-for-frontend (BFF), an opaque HttpOnly session cookie, and server-held Supabase tokens. Its responses must contain only a minimal allowlisted session summary. Local Supabase behavior has not been exercised because the Docker daemon was unavailable during Milestone 1; the test setup and acceptance checks are in the authentication feasibility memo.

The conditional Supabase architecture is approved for fictional development. Real institutional emails may be processed by Supabase only after the appropriate university personnel explicitly authorize that processing. This milestone does not authorize those identities, provider credentials, or actual account creation.

## Campus Wins limits

The interface offers only approved milestone templates, with ❤️, 👏, and 🔥 reactions. It has no free-text posts, comments, messaging, public-name editing, or image upload. Demo submissions remain local to the fictional preview; a demo approval button is not a production moderation control.

## Deployment and operations

`npm run build:production` creates the Pages static artifact. `_headers` sets restrictive same-origin security headers, a no-index directive, short asset revalidation, and no-store caching for demo fixtures. Pages Function/API responses will need to set their own headers when those functions are introduced.

GitHub Actions CI runs checks only; the workflow has read-only repository permissions and no deployment credentials. No public deployment is authorized. See [`docs/roadmap.md`](docs/roadmap.md) for the milestone sequence and remaining launch decisions.

The draft EUE wordmark remains clearly identified as draft artwork. Replace it only when an approved official asset is supplied.

## Legacy pilot files

- `arena/` — FastAPI pilot retained for domain and test reference; do not deploy unchanged.
- `assets/server-adapter.js` — legacy FastAPI adapter excluded from Pages builds.
- `tests/smoke_api.py` — baseline backend behavior check.
- `data/sample-approved-ranks.example.csv` — fictional schema example, ignored by Git; never use real data in development or tests.
