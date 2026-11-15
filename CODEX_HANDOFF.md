# Academic Arena — engineering handoff

## Current milestone

Milestone 1 prepares the approved V6 frontend for Cloudflare Pages. It keeps the vanilla HTML/CSS/JS application, original art, EUE draft identity, crown-above-winner podium, level/semester/module filters, both avatar families, customization, Campus Wins, and responsive layout.

The feature branch adds explicit demo and production build modes, a same-origin frontend data-access contract, unavailable/loading/empty states, local Wrangler preview, build and browser regression tests, and CI. Demo rows and posts are loaded only from the fictional fixture. Production output excludes that fixture, the old FastAPI adapter, unused legacy photos, and the artwork source sheet.

No Supabase or Cloudflare project is configured, no real account or student record has been used, and there is no public deployment. CI does not deploy.

## Commands

```bash
npm ci
npm test
npm run build:demo
npm run build:production
npm run test:browser
```

Run `npm run preview` for the fictional local Pages preview. Run `python tests/smoke_api.py` with the pinned Python requirements to check the retained legacy FastAPI behavior; do not deploy the legacy service unchanged.

## Authentication decision

The conditional Supabase architecture is approved for fictional-data development only. Supabase's user object contains email, and Supabase JWTs require an email claim. Direct browser Auth therefore does not keep the provider email private from the authenticated browser. Milestone 2 must use a same-origin BFF and an opaque HttpOnly session cookie. Supabase access/refresh tokens and the username-to-email mapping remain server-side. BFF responses must not contain provider user objects, provider email, IDs, tokens, or account mappings.

Actual institutional emails may be imported only after the appropriate university personnel explicitly authorize external processing in Supabase. No real student identities, credentials, academic records, production provider credentials, account provisioning, or public deployment are authorized by Milestone 1.

## Next milestones

1. **Milestone 2:** locally test a same-origin BFF with fictional accounts; design and review migrations, ownership rules, RLS, rate limits, opaque sessions, password-change/recovery, staff-only provisioning, and staff MFA enforcement. Keep real institutional email processing behind its explicit authorization.
2. **Milestone 3:** implement atomic versioned leaderboard publishing and rollback, staff account operations, template-only Campus Wins moderation, and one-reaction-per-account behavior.
3. **Milestone 4:** run independent security review, operational backup/restore drill, quota and outage runbooks, mobile/accessibility review, and release readiness. A public launch needs separate explicit authorization.

See [`docs/roadmap.md`](docs/roadmap.md), [`docs/architecture/m1-frontend-foundation.md`](docs/architecture/m1-frontend-foundation.md), and [`docs/auth/username-password-feasibility.md`](docs/auth/username-password-feasibility.md).
