# Academic Arena V1 roadmap

## Status as of 17 November 2026

| Milestone | Status | Scope / exit gate |
| --- | --- | --- |
| 0. Audit and architecture | Complete | V6 audited; baseline FastAPI smoke flow passed; free-tier and auth feasibility documented; threat model and migration diff recorded. |
| 1. Deployable frontend foundation | **Complete** — merged as `01a4808097b545523cd653b39b3c8fa7e397b3cd`; PR #2 reviewed independently and hosted CI passed | Pages build modes with a Cloudflare demo-build guard, fictional-only demo fixtures, production fail-closed states, same-origin data/auth contract, security headers, CI, and local desktop/mobile checks. No public deployment is authorized. |
| 2. Authentication and database | **Complete (development foundation)** — PR #3 merged `47bc13a` | Same-origin BFF, private username mapping, opaque sessions, rate limits, fail-closed credential sync with operator release, staff TOTP/AAL2, restrictive RLS. Account-lifecycle routes stay disabled outside the local test environment. |
| 3. Publishing and moderation | **Complete** — PR #4 merged `eb526df` | Strict CSV validation, draft preview, atomic versioned publish/rollback/withdraw, public catalog/board/feed APIs, Campus Wins templates with transactional limits, moderation, atomic reactions, staff desk UI. |
| 4. Security and operational readiness | **In progress** — branch `m4/ops-and-deploy` | Encrypted backup/restore (local drill passed), deployment/rotation/outage/takedown runbooks, staff guide. Hosted deployment waits for owner logins; real data waits for university approval. |

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
