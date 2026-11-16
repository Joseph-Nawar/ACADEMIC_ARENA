# Academic Arena V1 roadmap

## Status as of 16 November 2026

| Milestone | Status | Scope / exit gate |
| --- | --- | --- |
| 0. Audit and architecture | Complete | V6 audited; baseline FastAPI smoke flow passed; free-tier and auth feasibility documented; threat model and migration diff recorded. |
| 1. Deployable frontend foundation | **Complete** — merged as `01a4808097b545523cd653b39b3c8fa7e397b3cd`; PR #2 reviewed independently and hosted CI passed | Pages build modes with a Cloudflare demo-build guard, fictional-only demo fixtures, production fail-closed states, same-origin data/auth contract, security headers, CI, and local desktop/mobile checks. No public deployment is authorized. |
| 2. Authentication and database | **Implementation candidate; independent review pending** on `m2/auth-database-foundation`; fictional local development only | Same-origin BFF, private username mapping, opaque/revocable sessions, persistent rate limits, account lifecycle/recovery, owner-derived avatar writes, restrictive RLS, staff TOTP/AAL2. Local Supabase verification passes 130 pgTAP/RLS assertions and 29 live integration tests, including recovery interleaving, direct PostgREST domain/gate checks, and atomic MFA audit. Hosted provider configuration, external identity authorization, initial admin bootstrap, and sole-admin factor recovery remain gated. No real identity import or public deployment. |
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
- M2's local Auth, BFF, session, account lifecycle, staff MFA/AAL2, and RLS foundation has provider-backed fictional-data coverage; it still requires independent review and an explicitly authorized hosted integration before real identities can be used. M3 must pass atomic publication and rollback, complete board retirement, and moderation controls.
- M4 must complete the backup/restore drill, free-tier quota and pause runbooks, independent security review, and explicit launch authorization.

The current branch and CI workflow are for review and local/automated preview only. No workflow publishes a site or consumes production credentials.
