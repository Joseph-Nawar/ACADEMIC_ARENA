# Academic Arena V1 threat model

- **Status:** Updated for M1 implementation. Static frontend controls are in place on the feature branch; server-side identity, RLS, publishing, moderation, and operations controls remain pending their later milestones.
- **Reviewed:** 15 November 2026
- **Scope:** V6 pilot and proposed Cloudflare Pages + Supabase Free architecture.

## Security objectives

1. Keep grades, scores, raw attendance, student IDs, credentials, emails, sessions, internal roles, account links, and private university records out of public responses and static assets.
2. Publish names and ranking positions only with explicit university approval, notice/consent/opt-out policy, correction path, and takedown process.
3. Let each student change only their own avatar and eligible Campus Wins submissions/reaction. Only authorized staff manage accounts, moderation, and publication.
4. Fail closed when authentication, database, or quota services are unavailable. Never substitute fictional data on a live site.
5. Preserve the approved V6 experience while moving away from the pilot’s single-process server and SQLite assumptions.

## Assets and data classification

| Asset | Classification | Required treatment |
| --- | --- | --- |
| Approved public board rows and published Campus Wins | Public only after university approval | Exact allowlist, versioned publication, cache/revocation plan |
| Student username, legitimate provider email if approved, account status, role, password hash/provider credentials | Confidential | Server-side only, least privilege, no logs or static files |
| Account-to-public-identity link and staff mapping | Restricted | Staff/function-only access; never returned by public queries |
| Session cookies, refresh tokens, CSRF values, service-role key | Secret | HttpOnly/Secure cookies where applicable; server secrets only; never in Git, browser bundles, logs, or PR text |
| Unpublished CSV and raw academic source data | Highly restricted | Raw data and ranking calculations stay offline; only approved sanitized output may be uploaded |
| Avatar preference, moderation queue, audit records | Confidential | Ownership checks and restrictive RLS; audit changes without credential content |
| V6 art and static UI | Public asset after rights review | Preserve original approved assets; replace draft logo only with supplied official asset |

## Principals and trust boundaries

- Anonymous visitor: may read only currently published, allowlisted public content.
- Student: may act only as the account proven by the approved identity flow. May update their avatar and eligible post/reaction data.
- Moderator: may review Campus Wins; cannot change rankings or provision accounts unless separately authorized.
- Publisher/admin: may provision/suspend accounts and publish/rollback rankings under stronger authentication and MFA.
- GitHub/Cloudflare/Supabase custodians: can change code or service configuration. Limit to named approved operators with recovery coverage.
- University source system: remains outside the public application and supplies only an approved sanitized publication file.

Trust boundaries are the browser/static site, Pages/Worker functions, Supabase Auth, the Postgres Data API/RLS boundary, staff devices, GitHub/CI, and the university’s offline data environment. Any boundary that handles credentials, private mappings, or publication authority must have an explicit server-side control.

## Threats and current status

| ID | Threat | V6 evidence / current status | Required V1 control |
| --- | --- | --- | --- |
| T1 | Public disclosure of an unapproved name/rank or cohort | Demo screenshots and example CSV are stated to be fictional; no institutional approval evidence is included. | Hide real boards until director/privacy/IT approval and opt-out/takedown policy. Publish only explicit approved fields. |
| T2 | Student claims another student’s identity | V6 CLI can bind a username to a public row and checks matching display name; there is no tested institutional identity source. | Staff-provisioned account plus private binding from an authoritative approved roster. No student self-claim or public username lookup. |
| T3 | IDOR/BOLA or mass assignment changes another user’s avatar, identity, role, or rank | Pilot API checks current account for avatar updates and has no public role/rank write API; production RLS does not exist. | RLS on every exposed table; server-side ownership and allowlisted writes; immutable student-facing identity/rank fields; automated role-matrix tests. |
| T4 | Credential stuffing or username enumeration | Generic invalid-credential response and per-account lockout exist. IP attempts are stored in a process-local in-memory map, not distributed, and there are no submission/reaction limits. | Distributed/edge rate limits with bounded storage, generic errors, no availability endpoint, monitoring, and provider limits. Test concurrent attempts. |
| T5 | Staff account takeover or privilege abuse | Staff and students use the same password-only login. No MFA or separate publisher role is present. | Staff TOTP MFA required and enforced server-side (AAL2/RLS or equivalent); least-privilege moderator/publisher roles; named primary and backup custodians; audit trail. |
| T6 | Session theft, CSRF, or stale access after credential change | Pilot uses an opaque HttpOnly cookie, origin and CSRF checks, same-site lax, and 24-hour expiry. Password changes do not revoke other sessions; deployment-wide behavior is untested. | Secure/HttpOnly/SameSite cookies, short and revocable sessions, CSRF/origin protections, session revocation on password reset/suspension, HTTPS-only production, tests through Pages. |
| T7 | Stored XSS or harmful student-supplied content | M1 removes free-text Campus Wins fields from the frontend and exposes only fixed template keys; the legacy FastAPI API is not in the Pages build. | Keep the server API template-only in M3. Escape staff-controlled labels and validate every template key server-side before moderation/publication. |
| T8 | Spam, duplicate submissions, race conditions, or reaction identity leakage | Pilot has no server-side weekly/pending submission caps. A uniqueness constraint exists for reactions, but toggle uses read-then-write rather than an atomic upsert. Public responses return counts only. | Enforce one pending and one/week per account; atomic reaction upsert/toggle; rate limits; counts only; no reactor identities. |
| T9 | Incorrect/incomplete publication leaves stale boards visible | CLI replaces rows only for boards present in the upload. Omitted/retired boards remain; there is no version history, preview, rollback, or global atomic publication. | Validate complete expected board set, version snapshots, preview diffs, atomically publish and retire omissions, rollback and urgent unpublish. |
| T10 | Malicious or sensitive CSV leaks through upload, logs, Git, or browser | CLI has a strict column allowlist and the sample account mapping is private; no staff UI, upload route, audit log, or CSV privacy workflow exists. | Upload only sanitized allowlisted data through privileged server path; reject unknown columns/rows; keep files out of Git/logs; audit staff actions. |
| T11 | Demo fallback displays fictional or outdated values on a live site | Resolved for the M1 frontend: build mode is explicit, production excludes the fixture, and failed/missing same-origin API routes show unavailable states. No static approved snapshot is implemented. | Keep production mode fail-closed. Any later static snapshot needs approval, a visible date, revocation testing, and cache removal instructions. |
| T12 | Free-tier pause/quota loss or data loss | Pilot uses SQLite and has no backup/restore or quota monitoring. Supabase Free pauses after inactivity and has no automatic DB backup. | Encrypted offsite manual exports; before-publication and weekly active-term backups; tested restore; quota monitoring; no paid fallback/keepalive. |
| T13 | Privileged key, CSV, or test credential is committed | M1 adds a secret-pattern scanner in read-only CI; fixtures use fictional identities and no provider credentials. A scanner cannot detect every secret or replace credential rotation. | Keep private; review CI findings; service-role credentials only in a server secret store; use fictional test records; confirm account owner/custodians before production. |
| T14 | Compromised or single-person-owned source control | GitHub reports the repo owner as a personal user account, not an institution. | Move to an institution-controlled owner or approved custodians, enable MFA, set branch protections and require review before production. |

## Required launch gates

- The Supabase/BFF architecture is approved for fictional development. Before real identities, obtain separate authorization for institutional email processing and an approved source for account ownership; staff MFA must be enforceable.
- University privacy/director/IT approval of every public field, notices, consent/opt-out, correction, retention, and takedown.
- Versioned PostgreSQL migrations and RLS tests for anon, student, moderator, publisher, and suspended users.
- Atomic publishing, omitted-board retirement, rollback, and static cache revocation tests.
- Campus Wins template-only design, server-side weekly/pending limits, moderation, and urgent removal.
- Backup/export and restore drill; quota monitoring; staff pause/recovery procedure.
- Mobile, keyboard, contrast, and security verification; independent security review before production.

## Residual risks

Free tiers can pause or exhaust quotas and provide limited operational guarantees. A public ranking can be sensitive even when it contains no score. TOTP recovery can lock out staff if custody is not planned. Static snapshots can persist in caches or copies after publication and therefore need a tested revocation procedure. These risks remain until the university approves the disclosure and operating model.
