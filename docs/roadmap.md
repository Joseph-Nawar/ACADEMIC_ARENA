# Academic Arena V1 roadmap

## Status as of 15 November 2026

| Milestone | Status | Scope / exit gate |
| --- | --- | --- |
| 0. Audit and architecture | Complete | V6 audited; baseline FastAPI smoke flow passed; free-tier and auth feasibility documented; threat model and migration diff recorded. |
| 1. Deployable frontend foundation | Implemented on `m1/pages-foundation`; PR #2 open; fresh independent review is clean, awaiting hosted CI on the repair commit | Pages build modes with a Cloudflare demo-build guard, fictional-only demo fixtures, production fail-closed states, same-origin data/auth contract, security headers, CI, and local desktop/mobile checks. Keep the PR unmerged pending code-owner acceptance. |
| 2. Authentication and database | Next; fictional development is authorized | Build a same-origin BFF, local Supabase test stack, migrations, ownership rules, RLS, staff-only provisioning, password changes/recovery, revocable opaque sessions, generic auth responses, rate limits, and staff MFA/AAL2 enforcement. No real account import during M1. |
| 3. Publishing and moderation | Not started | Staff account management, sanitized CSV validation/preview, complete versioned atomic publication, omission retirement and rollback; fixed Campus Wins templates, approval/moderation actions, server limits, and atomic reactions. |
| 4. Security and operational readiness | Not started | Independent security and privacy review, mobile/accessibility QA, secret/abuse checks, manual encrypted backup and restore drill, quota/outage runbooks, CDN snapshot revocation where approved, deployment docs, and separate release authorization. |

## Approved decisions

- Preserve the vanilla V6 frontend and approved illustrated identity; do not introduce an unnecessary framework rewrite.
- Use explicit `demo` and `production` build modes. Only the demo build contains fictional records. Production never substitutes demo records for missing API data.
- Use Cloudflare Pages Free for static delivery and same-origin Pages/Worker functions when backend routes are introduced; use Supabase Free for provider Auth and PostgreSQL only after the required institutional data-processing authorization.
- Conditional Supabase authentication is approved for fictional development. Direct browser Supabase Auth is rejected because the Auth user object and JWT expose email. The BFF must use an opaque HttpOnly cookie and return only allowlisted session state; provider tokens and username/email mappings remain server-side.
- Keep raw academic records and ranking calculations outside the public application. Public names and positions require separate university approval.
- Campus Wins uses approved templates, staff review, and only ❤️, 👏, and 🔥. No free text, comments, messages, or image uploads.
- Do not create a public deployment, real provider accounts, or real student records under the M1 authorization.

## Decisions still required before real data or launch

- Appropriate university personnel must explicitly authorize external processing of real institutional emails in Supabase before any such import.
- The university must approve provider ownership, terms/data-processing region, staff custodians, public name/rank disclosure, notices/opt-out and correction/takedown, account recovery, retention, and operational ownership.
- M2/M3 must pass role-based RLS and BFF tests, staff MFA/AAL2 enforcement, session revocation, server-side account/rate limits, atomic publication and rollback, and moderation controls.
- M4 must complete the backup/restore drill, free-tier quota and pause runbooks, independent security review, and explicit launch authorization.

The current branch and CI workflow are for review and local/automated preview only. No workflow publishes a site or consumes production credentials.
