# Academic Arena V1 threat model

- **Status:** Updated for the M2 local implementation candidate on `m2/auth-database-foundation`. Auth, BFF sessions, account lifecycle, staff MFA, and database/RLS behavior have been exercised against local Supabase using fictional identities. Hosted provider configuration, independent review, publication/moderation, and operational readiness remain incomplete.
- **Reviewed:** 16 November 2026
- **Scope:** V6 pilot and the approved Cloudflare Pages + Supabase Free architecture. No public deployment or real university data is in scope for this branch.

## Security objectives

1. Keep grades, scores, raw attendance, student IDs, credentials, emails, provider tokens, private mappings, and university records out of public responses and static assets.
2. Publish names and ranking positions only after explicit university approval, notice/consent/opt-out policy, correction path, and takedown procedure.
3. Let each student change only their own avatar. Reserve account management and future publication/moderation for authorized staff with role checks and MFA.
4. Fail closed when authentication, database, or quota services are unavailable. Never substitute fictional data on a live site.
5. Preserve the approved V6 experience while replacing the pilot's single-process server and SQLite assumptions.

## Assets and data classification

| Asset | Classification | Required treatment |
| --- | --- | --- |
| Approved public board rows and Campus Wins | Public only after university approval | Explicit field allowlist, versioned publication, cache/revocation plan. No production rows exist. |
| Student username, legitimate provider email if authorized, account status, provider identity | Confidential | Private mapping, server-only access, least privilege, never log or return to the browser. |
| Account-to-public-identity link and staff roles | Restricted | Private schema and server authorization; never included in public JSON. |
| Session cookies, provider access/refresh tokens, CSRF material, service-role key | Secret | Opaque Secure/HttpOnly cookie; encrypted server-side provider/CSRF values; server secrets only; never in Git, browser-readable storage, logs, or PR text. |
| Unpublished CSV and raw academic source data | Highly restricted | Keep calculations and raw data offline; upload only an approved sanitized publication file in a later milestone. |
| Avatar preference, moderation queue, audit records | Confidential | Avatar owner derived from authenticated identity; private workflow data and credential-free audit. |
| V6 art and static UI | Public asset after rights review | Preserve approved art; replace draft EUE mark only with an approved asset. |

## Principals and trust boundaries

- Anonymous visitor: may read only currently published, allowlisted projections. The local test schema has fictional rows; no production rows are present.
- Student: acts only as the staff-provisioned account resolved by the private BFF mapping. May change only their own avatar.
- Moderator/publisher/admin: least-privilege staff roles. Every privileged BFF operation rechecks current account status, current role, and verified TOTP/AAL2. Local account lifecycle routes are disabled outside `ENVIRONMENT=test`; a private database-side gate also defaults off and is enabled only by the local fictional seed.
- GitHub, Cloudflare, and Supabase custodians: can change code or service configuration. Limit to approved operators with MFA, named backup custodians, and recovery procedures before launch.
- University source system: remains outside the public application and supplies only an approved sanitized publication file after authorization.

Trust boundaries are the browser/static site, Pages Functions BFF, Supabase Auth, Postgres/PostgREST RLS, staff devices, GitHub/CI, and the university's offline data environment. The browser has no Supabase client, provider JWT, or service key. The BFF holds provider credentials and the private mapping. Every boundary requires independent authorization and tests.

## Threats and current status

| ID | Threat | M2 evidence / current status | Remaining control or gate |
| --- | --- | --- | --- |
| T1 | Unapproved name/rank or cohort disclosure | Static production bundle excludes demo records; public schema exposes only rank position, approved public name/avatar, and competition dimensions. No production data is seeded. | Keep all production publication disabled until the university approves each public field, consent/notice, opt-out, correction, and takedown process. |
| T2 | Student claims another identity | Username resolves only through `app_private`; no lookup/availability endpoint exists. Provisioning sets only the student role and forces a password change. BFF lifecycle routes are test-environment-only and corresponding PostgREST RPCs require a private default-off database gate. SQL provisioning also enforces the reserved fictional email domain and returns no account ID. | Authorize an authoritative roster and real-email processing before hosted accounts; no self-claim flow. |
| T3 | IDOR or mass assignment changes another user's avatar, role, or rank | Actual local PostgREST tests prove private schema denial, account isolation, owner-key denial, and role escalation denial. Avatar reads use RLS; a narrow atomic RPC derives owner from `auth.uid()`. Direct browser table writes are revoked. BFF accepts only avatar fields. | Repeat independent authorization review; keep future writes on narrowly scoped server/RLS-checked operations. |
| T4 | Credential stuffing or username enumeration | Unknown, wrong, suspended, and throttled login requests return generic 401 responses with minimum duration. HMACed username and edge-IP buckets persist in Postgres; concurrent rate-limit tests pass. | Review limits against hosted quotas/traffic; monitor abuse and ensure the deployed edge controls the client-IP header. No hosted abuse exercise has occurred. |
| T5 | Staff account takeover or privilege abuse | Local Supabase Auth TOTP enrollment and step-up produce AAL2; BFF and SQL permissions deny staff at AAL1. Session token step-up and audit insertion are atomic. MFA reset requires a different AAL2 admin and blocks login until provider-factor deletion completes. Lifecycle RPC bypass is blocked by the database gate; audit events omit credentials. The browser receives the TOTP secret only, not the provider URI that may include email. | The in-app staff MFA reset deletes factors and forces a password change but does **not** issue a fresh password; it must stay disabled for hosted identities until it does. Staff MFA reset releases its claim after any failure (read, or delete by existing factor ID). Sole-admin factor loss uses the owner-only break-glass in `docs/operations/identity-runbook.md`: app-state lock/finish in SQL, factor deletion and a mandatory fresh password through the Auth Admin API. Auth has no admin call to revoke all provider sessions; issued access JWTs live until expiry. Approve named custodians and the identity-verification step; rehearse on hosted fictional staging. |
| T6 | Session theft, CSRF, stale token, or session misuse | Random opaque `__Host-` cookie is Secure/HttpOnly/SameSite=Strict with no Domain; database stores only its hash. Provider and CSRF values are encrypted at rest. Exact Origin and session-bound CSRF checks protect mutations. BFF revocation is server-side and tested. Recovery revokes sessions and blocks new login/session resolution until provider synchronization finishes. A non-expiring claim permits one Auth Admin operation per credential generation; the matching token hash is required for release/finalization. Local delayed-provider testing proves a request completing after BFF timeout cannot be overtaken by a newer generation. | Provider JWTs already issued remain acceptable to PostgREST until their short expiry; browser never receives them and RLS checks account status. An ambiguous password-update outcome keeps the claim and account pending until the database owner runs the explicit release in the runbook (no time-based release, because Supabase Auth does not accept our fencing token); a late stale write can then only cause lockout, fixed by another recovery. Expired retry ciphertext is erased by a per-minute pg_cron job and on login; not guaranteed while a free project is paused, and erased bytes persist in storage/WAL until vacuum and in earlier backups. |
| T7 | Stored XSS or harmful student content | M1 frontend offers only approved Campus Wins templates; no free text, comments, messaging, or image upload. M2 has no submission endpoint. | Keep template allowlists and staff moderation server-side in M3; escape approved labels and test before enabling submissions. |
| T8 | Spam, duplicates, race conditions, or reaction identity leakage | M2 tests concurrent session, rate-limit, and avatar writes. No Campus Wins submissions/reaction API is implemented. | M3 must implement atomic post limits/reaction upsert, moderation, and aggregate-only public counts. |
| T9 | Incorrect publication leaves stale boards visible | M2 defines versioned snapshot tables, constraints for level/semester/module and a single current snapshot; no writer or live ranking is implemented. | M3 must validate the complete board set, retire omitted boards atomically, support preview/rollback/unpublish, and test cache revocation. |
| T10 | Sensitive CSV leaks through upload, logs, Git, or browser | Raw academic sources remain outside the app; no CSV upload route is implemented. | M3 must accept only sanitized allowlisted input through a privileged path and keep files out of Git/logs. |
| T11 | Demo data appears on production | M1 uses explicit demo/production modes, rejects demo builds on Pages, excludes fixtures from production bundles, and fails closed when APIs are unavailable. | Keep deployment workflows disabled until separately authorized. No public deployment is authorized. |
| T12 | Free-tier pause, quota exhaustion, or data loss | Architecture uses only Cloudflare Pages Free, Supabase Free, and GitHub Free. No keepalive, paid fallback, or hosted service is configured. | M4 still requires encrypted offsite backup, restore drill, quota/pause monitoring, staff recovery/runbooks, and snapshot revocation. |
| T13 | Secret, provider token, or credential committed/exposed | CI is read-only and has secret scanning; local tests generate ephemeral keys and fictional passwords; local Auth/provider responses are checked for browser non-disclosure. Provider keys are not in the frontend bundle. | Secret scanners are incomplete. Hosted binding setup, rotation, operator access, and provider log/retention controls need review before integration. |
| T14 | Compromised or single-person-owned source control | CI is pinned, pull-request based, and has read-only repository permissions. | Repository currently has an individual owner; institutional ownership/custodians, MFA, protected branches, and required review remain to be approved. |

## Session and authorization assumptions

The BFF validates a provider token with Supabase Auth on requests and derives account/role state from private database records. It never trusts browser-supplied account IDs, roles, usernames after sign-in, or MFA flags. Student table reads use the user JWT and RLS. Avatar writes call an authenticated function that derives the owner from `auth.uid()` and allowlists character fields; the function is narrowly granted, and the underlying table has forced RLS with no browser insert/update privilege.

The server-side session row can be revoked immediately. Supabase access JWTs cannot be made cryptographically disappear after issuance and may remain accepted by PostgREST until expiration. That is bounded by provider expiry, is not browser-accessible in this architecture, and is separately constrained by active-account/forced-password checks in RLS. Hosted expiration and revocation behavior still requires integration confirmation.

## Required launch gates

- Obtain university authorization for legitimate email processing in Supabase before importing any real identities; approve provider ownership, terms/region, staff custodians, initial admin bootstrap, and account recovery.
- Obtain separate approval for public names/rankings, notices, consent/opt-out, correction/takedown, retention, and publication ownership.
- Complete independent security review of the BFF, session revocation, staff MFA, SQL grants, RLS, and account lifecycle before enabling hosted identity operations.
- Implement M3 atomic publishing, complete board retirement, rollback, Campus Wins templates/moderation/reactions, server-side limits, and removal controls.
- Complete M4 encrypted backup/restore drill, free-tier quota/pause runbooks, mobile/accessibility QA, operational ownership, and deployment authorization.

## Residual risks

Local provider tests establish the behavior of the pinned local Supabase Auth/Postgres/PostgREST stack, not a hosted project's configuration or contractual approval. The identity lifecycle routes currently reject all non-test environments, and the database lifecycle gate remains off in migrations unless the fictional local seed enables it. Recovery-pending, claim, and credential-epoch tests verify that login/password changes cannot bypass a concurrent student or staff-provider reset; the delayed-provider test verifies the fail-closed result after BFF timeout and later upstream completion. A held password-update claim never expires automatically, because Supabase Auth does not enforce our fencing token and no provider-side bound shows when a delayed update can no longer apply. The BFF releases it only for Auth's documented pre-write error codes; every other outcome keeps the student blocked until the database owner runs the explicit release in `docs/operations/identity-runbook.md`. Release destroys the never-revealed temporary password, so a late provider write can only leave an unknown password (availability loss, no disclosure); the student is recovered again. Expired encrypted payloads are erased by a per-minute pg_cron job and on login, i.e. within about 16 minutes while the database runs; there is no guarantee while a free project is paused, and erased bytes persist in storage/WAL until vacuum and in earlier backups. First-admin bootstrap and sole-admin break-glass are owner-only and change only application tables; provider changes go through the Auth Admin API. Both are tested locally only and need hosted fictional-staging rehearsal and institutional approval. Provider JWTs remain valid until expiry even after the BFF row is revoked. Free tiers can pause or exhaust quotas and do not provide the backup/availability commitments of paid plans. A public ranking can be sensitive even when it omits scores. These risks remain open and block production deployment.

## M3 additions (17 Nov 2026)

- **Publication:** staff (publisher/admin) at AAL2 only, enforced in SQL. Atomic versioned swaps under an advisory lock and a one-current unique index. Drafts and older versions are hidden by RLS. Column grants hide snapshot metadata. Uploads accept an exact column allowlist; no raw CSV is stored.
- **Public APIs:** read through the anon key under RLS and return only allowlisted fields, with `private, no-store`. Rendering uses `textContent` only.
- **Campus Wins:** fixed templates and staff-approved names. Submission limits are enforced under a row lock. Pending posts never reach the public table (trigger). Moderation needs moderator/admin at AAL2. Reactions: one per student per post, counts updated under a post row lock, no self-reactions, viewer state via an authenticated endpoint only.
- **Residual:** reactions have no per-user rate limit; suspension does not auto-hide published posts; one shared unpublished draft.

