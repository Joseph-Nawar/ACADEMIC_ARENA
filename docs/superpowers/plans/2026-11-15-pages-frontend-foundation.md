# Academic Arena Pages Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Package the approved V6 frontend for Cloudflare Pages with explicit demo/production modes, a future BFF data contract, reproducible checks, and no production demo fallback.

**Architecture:** Keep vanilla HTML/CSS/JavaScript. Generate a static dist folder with Node 24, use a mode-specific runtime config, keep fictional records in a demo-only fixture, and route future authenticated work through same-origin BFF endpoints.

**Tech Stack:** Node 24, npm lockfile, Cloudflare Wrangler Pages dev, Playwright, Python 3.12 for legacy smoke tests, GitHub Actions.

**Spec:** docs/architecture/m1-frontend-foundation.md plus docs/architecture/free-tier-v1.md, docs/auth/username-password-feasibility.md, docs/security/threat-model.md, docs/architecture/v6-migration-diff.md, and the Milestone 1 user request.

## Global Constraints

- Keep the V6 vanilla frontend and approved artwork; do not redesign it or migrate frameworks.
- Keep staging and tests fictional.
- Production mode cannot silently display fictional demo rankings.
- Never expose grades, Academic Scores, attendance histories, student IDs, private identity mappings, credentials, unpublished posts, or moderation drafts in public responses or generated production assets.
- Do not add paid services, public deployment, real accounts, real institutional data, or production credentials.
- Do not put Supabase service-role credentials or auth tokens in browser bundles.
- Public Campus Wins use approved achievement templates and positive predefined reactions; no free-text submission, comments, messaging, or arbitrary uploads.
- Use a same-origin backend-for-frontend for future Supabase authentication and privileged operations.
- Preserve level 4/5/6, semester 1/2, module selection, podium/crown, EUE draft identity, both character families, customization, Campus Wins, and responsive layouts.

## Review Focus

- Missing or malformed runtime config must use production/unavailable mode and never load demo rows; Task 1 and Task 3 tests.
- A backend response with private or unrecognized keys must not pass through the public adapter; Task 2 test.
- Invalid or quickly changing filters must not display a stale board or fabricate an empty successful result; Task 2 and Task 3 tests.
- Failed public requests and unavailable browser storage must leave the page usable and visibly unavailable; Task 2 and Task 3 tests.
- Mobile viewport width must not produce horizontal overflow or hide the podium/filter controls; Task 3 browser test.

---

### Task 1: Reproducible Pages build and safe runtime modes

**Files:**
- Create: package.json, package-lock.json, .nvmrc, wrangler.jsonc, scripts/build.mjs, public/_headers, tests/frontend/build.test.mjs
- Modify: .gitignore

**Interfaces:**
- Produces npm run build:demo and npm run build:production, both writing dist.
- Produces dist/assets/runtime-config.js with only mode and same-origin API base.
- Produces a Pages-compatible dist containing index.html, required assets, and _headers.

- [x] Write tests named production_build_excludes_fixtures_and_pilot_backend, build_modes_write_explicit_runtime_config, and pages_headers_set_security_and_revalidation.
- [x] Run node --test tests/frontend/build.test.mjs and confirm the missing-build failures.
- [x] Implement an allowlist-based Node build script. Demo output may copy fixtures/demo; production output must omit fixtures, FastAPI files, local data, and assets/server-adapter.js.
- [x] Add a pinned Node/Wrangler/Playwright package manifest and lockfile. Add scripts for build, test, and local Wrangler Pages preview.
- [x] Add Cloudflare Pages security headers and conservative cache rules. Keep CSP same-origin and remove the need for inline script/style policy exceptions.
- [x] Run node --test tests/frontend/build.test.mjs and confirm all three tests pass.

### Task 2: Frontend data and authentication contract

**Files:**
- Create: assets/data-access.js, fixtures/demo/academic-arena.json, tests/frontend/data-access.test.mjs
- Modify: package.json if a test script needs adjustment

**Interfaces:**
- Consumes: runtime config mode and API base produced by Task 1.
- Produces: createArenaDataAccess({mode, fetchImpl, storage}) with public, auth, student, and staff method groups.
- Public filters are level, semester, group, kind, and module; student mutation bodies contain no owner ID or role.

- [ ] Write tests named public_board_query_encodes_all_filters_and_allowlists_rows, production_failure_never_falls_back_to_fixture, campus_wins_public_shape_excludes_private_and_free_text_fields, login_uses_same_origin_and_returns_only_sanitized_session, and student_and_staff_writes_do_not_accept_client_roles.
- [ ] Run node --test tests/frontend/data-access.test.mjs and confirm the missing-module failures.
- [ ] Implement the demo adapter using only fixtures/demo/academic-arena.json. Implement production same-origin request routes with generic authentication failures and fail-closed reads.
- [ ] Validate response shapes and return only public allowlisted board/post fields and sanitized session state. Include staff publishing/moderation and provisioning method boundaries; do not expose a Supabase client.
- [ ] Run node --test tests/frontend/data-access.test.mjs and confirm all tests pass.

### Task 3: Preserve the UI and connect loading/error states to the provider

**Files:**
- Create: tests/browser/m1-foundation.spec.mjs, scripts/run-browser-smoke.mjs
- Modify: index.html, assets/app.css, assets/app.js, tests/frontend/build.test.mjs, tests/frontend/ui-contract.test.mjs

**Interfaces:**
- Consumes: Task 2 provider methods for public catalog, leaderboard, wins, session, avatar, achievement, and reaction operations.
- Production initial markup contains no fictional names or ranking rows.
- Demo names and approved-template examples are loaded from the demo fixture only.

- [ ] Write UI contract tests for production placeholder markup, no free-text Campus Wins input, and a visible status region; run them and confirm failures.
- [ ] Write the Playwright flow tests for filters, podium/crown, avatar customization and both art families, Campus Wins filters/reactions, production-unavailable behavior, and mobile overflow; run them and confirm they fail before UI integration.
- [ ] Connect app.js to the data provider. Keep stale responses from replacing the latest filter selection. Render explicit loading, empty, and unavailable states.
- [ ] Move all fictional leaderboard and Campus Wins records out of app.js/index.html and into the demo fixture. Remove free-text achievement submission while preserving the existing Campus Wins visual feed and reactions.
- [ ] Keep avatar customization functional in demo mode and route production saves through the current-account endpoint.
- [ ] Replace inline style attributes and style assignments with allowlisted data attributes and CSS selectors.
- [ ] Run node --test tests/frontend/*.test.mjs and npm run test:browser; confirm browser flows pass at 1440 and 390 CSS pixels.

### Task 4: CI, secret checks, roadmap, and auth/security documentation

**Files:**
- Create: .github/workflows/ci.yml, scripts/check-secrets.py, tests/test_check_secrets.py, docs/roadmap.md
- Modify: requirements.txt, requirements-test.txt, README.md, CODEX_HANDOFF.md, docs/architecture/free-tier-v1.md, docs/auth/username-password-feasibility.md, docs/security/threat-model.md, docs/architecture/v6-migration-diff.md

**Interfaces:**
- Consumes: build/test/browser commands from Tasks 1-3.
- CI runs on pull requests and pushes with read-only repository permissions and no deployment secrets.
- Python smoke tests install the test client dependency without undocumented manual steps.

- [ ] Write secret scanner tests for private-key blocks, service-role/JWT-shaped secrets, safe placeholders, and fictional demo fixture exclusion from production output; confirm the synthetic-secrets tests fail before the scanner exists.
- [ ] Add a deterministic secret-pattern scan and static build checks. The scan must report file and line only and must never print the matched secret.
- [ ] Pin compatible FastAPI, Uvicorn, SQLAlchemy, Argon2, Pydantic, and httpx2 test dependency versions based on the passing baseline.
- [ ] Add one GitHub Actions workflow that installs Node/Python dependencies, runs frontend tests and both builds, runs browser smoke against local Pages, runs secret/static checks, and runs tests/smoke_api.py.
- [ ] Update the roadmap and architecture docs. Record the Supabase user-object/JWT email exposure finding and the required server-side opaque-session BFF; distinguish completed frontend contract work from pending M2 server security controls.
- [ ] Run npm ci, npm test, npm run build:demo, npm run build:production, npm run test:browser, npm run check:security, and python tests/smoke_api.py from a clean checkout.

## Pre-flight interfaces

- Task 2 consumes Task 1 runtime config fields and the build mode names. Ruling: use exactly demo and production; missing config means production.
- Task 3 consumes Task 2's grouped provider methods and status result shapes. Ruling: public reads return ok, empty, or unavailable; mutations return a sanitized result or a generic error.
- Task 4 consumes the command names and dependency versions from the earlier tasks. No CI secrets or deployment steps are needed.
