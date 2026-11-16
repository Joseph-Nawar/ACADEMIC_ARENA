# M2 Authentication and Database Foundation Implementation Plan

> **For agentic workers:** Use the native single-agent implementation method specified by the user. Execute each task as a test-first slice and commit reviewable changes on `m2/auth-database-foundation`.

**Goal:** Implement and locally verify the fictional-data Supabase Auth and database foundation behind the existing same-origin frontend contract.

**Architecture:** Cloudflare Pages Functions provide the same-origin BFF. Supabase Auth verifies passwords and TOTP; opaque cookie sessions and private mappings remain server-side; student data calls use provider JWTs and restrictive RLS. A pinned Supabase CLI native stack is the real local provider/test target, with live loopback-listener checks; no hosted credentials or external identities are used.

**Tech Stack:** Existing vanilla frontend and Node 24 tooling; Cloudflare Pages Functions/Workers runtime; Supabase CLI local stack, Auth, Postgres/PostgREST; `@supabase/supabase-js`, `jose`, `otpauth`, and `qrcode` pinned dependencies; Playwright and Node's built-in test runner.

**Spec:** `docs/architecture/m2-auth-database.md`, `docs/architecture/free-tier-v1.md`, `docs/auth/username-password-feasibility.md`, and `docs/security/threat-model.md`.

## Global Constraints

- Use fictional local identities and development data only; local tests may set the provider's confirmation flag on random reserved `*.academic-arena.test` users solely to exercise password auth, then delete the users. Do not create or link a hosted Supabase project.
- Keep deployment and infrastructure within the approved $0 Cloudflare Pages Free, Supabase Free, and GitHub Free plans.
- Never send provider emails, user objects, access/refresh tokens, service-role secrets, or private mappings to the browser.
- Keep public registration disabled and enforce staff-only provisioning and MFA/AAL2 server-side and in RLS.
- Preserve M1 UI and routes; add only minimal login/session/MFA states required to use the BFF.
- Keep M3 publication, CSV import, and moderation workflows out of this branch.
- Do not merge or deploy the M2 branch; open a PR for independent review.

## Review Focus

- Unknown, suspended, wrong-password, and throttled users must receive indistinguishable login status/body without an availability endpoint; local tests exercise each path and rate limit.
- A forged or expired cookie, CSRF token, Origin, role, account ID, or provider-session association must fail closed; tests exercise each forged value.
- A student must not read/change another avatar or obtain any role/session/mapping/grade data; actual PostgREST requests with two local provider users verify this.
- Staff requests at AAL1 must not provision/reset/suspend accounts; an actual local TOTP AAL2 flow and negative bypass tests prove the boundary.
- Parallel requests and password changes must not revive revoked sessions, race role changes, or exceed rate limits; local concurrent integration tests exercise these cases.

---

### Task 1: Local provider harness and M1 roadmap update

**Files:**
- Modify: `docs/roadmap.md`
- Create: `supabase/config.toml`, `supabase/seed.sql` (fictional only), `scripts/run-m2-local-tests.mjs`
- Modify: `package.json`, `package-lock.json`, `.gitignore`, `.github/workflows/ci.yml`
- Test: `tests/m2/local-stack.test.mjs`

**Interfaces:**
- Produces: reproducible `npm run supabase:start`, `npm run supabase:reset`, and `npm run test:m2:local` commands. The harness binds local services to loopback and captures local keys without printing them.

- [x] Update the roadmap to record M1 complete at merge commit `01a4808097b545523cd653b39b3c8fa7e397b3cd` and M2 active on this branch.
- [x] Add a failing stack-config check for public signup disabled, local-only Auth URLs, and fictional `.test` fixtures not marked verified.
- [x] Pin Supabase CLI and verify actual local Auth configuration. Provider-specific signup disabling rejects password sign-in, so project-wide signup is disabled instead; local password tests require `email_confirm=true` only for ephemeral fictional `.academic-arena.test` identities.
- [x] Implement local native-stack config/seeds and a cleanup-safe harness; assert actual Auth/API/database listeners are loopback-only and public signup is rejected by the Auth endpoint.
- [x] Create/delete random local fictional identities through Auth Admin and verify email/tokens remain in server-side test code.
- [x] Add the local Supabase native-runtime CI job without hosted secrets; retain M1 validation.
- [x] Commit the local provider foundation.

### Task 2: Database schema, roles, and Row Level Security

**Files:**
- Create: `supabase/migrations/202611160001_m2_identity_and_public_schema.sql`
- Create: `supabase/tests/identity_rls.test.sql`, `supabase/tests/public_projection_rls.test.sql`
- Test: `tests/m2/rls.integration.test.mjs`

**Interfaces:**
- Produces: private `app_private` account, role, identity-map, session, rate-limit, and audit structures; public avatar, leaderboard snapshot/row, and Campus Wins projection structures; narrowly granted server RPCs; RLS helper functions.

- [x] Write pgTAP deny/allow tests for anon, two students, moderator, publisher, suspended student, and staff at AAL1/AAL2; run them before the migration and confirm the expected missing-schema/table failures.
- [x] Add migration with RLS enabled and forced on every exposed table, column-level grants for public-safe projections, unique/check/foreign-key constraints, and least-privilege RPC grants.
- [x] Use `security definer` only where required, pin `search_path = ''`, fully qualify names, and revoke default execute grants.
- [x] Add actual local PostgREST tests proving anon cannot query private mappings/sessions, students are isolated to their own avatars, and roles cannot be changed by students.
- [x] Add snapshot board constraints for level, semester, cohort, board kind, and module key without storing scores or student IDs in public projections.
- [x] Commit the schema/RLS slice after `supabase db reset` and all pgTAP/RLS tests pass.

### Task 3: BFF session, request, and CSRF boundary

**Files:**
- Create: `functions/_middleware.js`, `functions/lib/{env,provider,session,csrf,validation,response,secure-crypto}.js`
- Create: `functions/api/auth/session.js`, `functions/api/auth/logout.js`
- Test: `tests/m2/session.integration.test.mjs`, `tests/m2/csrf.integration.test.mjs`

**Interfaces:**
- `resolveSession(request, env)` returns only server-side account/session context or an unauthenticated result.
- Provider access tokens are encrypted with JWE at rest; opaque cookie tokens are SHA-256 hashed before database lookup. No refresh token is returned to the browser.

- [x] Add HTTP tests for opaque `__Host-` cookie attributes, no-store headers, origin checks, invalid/expired/revoked cookie behavior, and logout revocation.
- [x] Add Pages Functions middleware and safe response builders; fail closed for missing secrets or malformed headers.
- [x] Implement session resolution/revocation with request-scoped Supabase clients and pinned JWE; cap expiry below provider JWT expiry and verify local provider refresh-token sign-out and PostgREST access-token expiry behavior.
- [x] Add CSRF token issuance bound to the session and exact same-origin checks on logout; login will reuse the same Origin helper in Task 4.
- [x] Verify responses contain no provider email/user/tokens, service key, private mapping, or cookie-readable session secret.
- [x] Commit the BFF/session slice after actual local Auth/PostgREST tests pass.

### Task 4: Username login, password change, rate limits, and account recovery

**Files:**
- Create: `functions/api/auth/login.js`, `functions/api/auth/change-password.js`
- Create: `functions/api/staff/accounts.js`, `functions/api/staff/accounts/recovery.js`, `functions/api/staff/accounts/suspend.js`
- Modify: `functions/lib/{provider,session,validation}.ts`
- Test: `tests/m2/login.integration.test.mjs`, `tests/m2/account-lifecycle.integration.test.mjs`, `tests/m2/rate-limit.integration.test.mjs`

**Interfaces:**
- Login accepts only `{username,password}`. Unknown, incorrect, suspended, and throttled failures share the same generic 401 response.
- Student provisioning is staff-only and forces role `student`; account reset returns one-time recovery material only to an authorized staff caller with `Cache-Control: no-store`.

- [x] Add local-provider tests for wrong password, unknown username, suspended user, no public registration, forced password change, staff recovery, suspension, and prior-session revocation.
- [x] Implement normalized private username resolution and account status/role checks without a public lookup route.
- [x] Add atomic Postgres rate-limit RPCs for keyed username and client-IP buckets; test concurrent attempts.
- [x] Implement staff-mediated provisioning/recovery/suspension with role checks, input allowlists, audit records, BFF session revocation, and provider-side password/ban operations. Routes are deliberately test-environment-only pending external identity authorization.
- [x] Prove password change clears the forced-change flag and makes old credentials and old BFF cookies unusable.
- [x] Commit lifecycle/rate-limit changes after provider-backed concurrency tests pass.

### Task 5: Staff TOTP MFA and privileged authorization

**Files:**
- Create: `functions/api/auth/mfa/enroll.js`, `functions/api/auth/mfa/verify.js`
- Modify: `functions/lib/session.js`, `functions/lib/authorization.js`, `functions/lib/mfa-authorization.js`
- Test: `tests/m2/mfa.integration.test.mjs`, `supabase/tests/staff_aal2.test.sql`

**Interfaces:**
- Staff login returns a restricted step-up state until Supabase reports verified TOTP and current AAL2.
- Every staff BFF operation rechecks active role and current AAL2; RLS policies independently require AAL2 for privileged database access.

- [x] Add tests for first staff factor enrollment, invalid codes, valid challenge/verify, AAL1 provisioning denial, and direct RLS AAL1 denial.
- [x] Use Supabase Auth TOTP APIs and a pinned OTP library; keep the setup key only in the one-time enrollment response and UI confirmation state.
- [x] Implement AAL2 checks in BFF authorization and restrictive RLS policies.
- [x] Run factor verification, rate-limit concurrency, and privileged-action tests against local Supabase.
- [x] Commit the MFA slice after provider-backed tests pass.

### Task 6: Minimal existing-UI integration and final verification

**Files:**
- Modify: `assets/data-access.js`, `assets/app.js`, `index.html`, `assets/app.css` only as needed for login, forced password change, and staff TOTP states.
- Modify: `docs/security/threat-model.md`, `docs/auth/username-password-feasibility.md`, `docs/architecture/m2-auth-database.md`, `README.md`, `docs/roadmap.md`, `.github/workflows/ci.yml`
- Test: `tests/browser/m2-auth.spec.mjs`, full M1 and M2 suites.

**Interfaces:**
- Keep the M1 `/api` data-access boundary and add only allowlisted M2 session/MFA state. Provider SDK and secrets remain server-only.

- [x] Add browser tests that inspect response bodies, browser storage, and cookies during fictional login, forced password change, logout, and staff MFA states.
- [x] Connect existing forms to the BFF with accessible pending/error states, preserving approved V6 styling.
- [x] Run clean `npm ci`, frontend tests (27/27), secret-scanner tests (4/4), production build and both secret scans, Chromium desktop/mobile browser smoke, local Supabase tests (109 pgTAP/RLS assertions and 28/28 live provider/BFF integration tests, including direct PostgREST lifecycle-gate denial), and retained FastAPI baseline smoke.
- [x] Update threat model, feasibility memo, README, roadmap, and architecture with verified local evidence, exact unverified provider/institutional gates, and residual risks; do not claim hosted-provider verification.
- [ ] Commit final implementation, push the M2 branch, open a PR, and request independent review. Do not merge or deploy.

---

## Review gates and completion criteria

M2 is not complete unless the local Supabase Auth/Postgres/PostgREST stack runs and all migration, RLS, provider lifecycle, session, abuse, cross-account, role, MFA, privacy, and concurrency tests pass. A mocked provider alone is insufficient. A hosted Supabase project, actual university emails, and public deployment remain outside this branch and must be listed as outstanding gates.
