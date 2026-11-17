# Academic Arena — Claude Code rules

University leaderboard (EUE). Vanilla HTML/CSS/JS frontend on Cloudflare Pages,
Pages Functions BFF in `functions/`, Supabase Auth + Postgres. **$0/month only:**
Cloudflare Pages/Functions Free, Supabase Free, GitHub Free. No framework rewrite.

Current status and next steps: `docs/progress.md` (read first).

## Non-negotiables

- Preserve the approved UI: EUE branding, illustrated podium, Comic and 3D
  Cartoon avatar families, cohort/module filters, Campus Wins.
- Privacy: never expose grades, Academic Scores, attendance, student IDs,
  private username/email mappings, provider tokens, or Supabase keys to the browser.
- Accounts: staff-issued username/password, no public sign-up, opaque
  `__Host-` BFF cookie sessions, staff TOTP/AAL2, server authorization + restrictive RLS.
- Campus Wins: predefined templates, staff approval, only ❤️ 👏 🔥 reactions.
  No free text, comments, messages, links, or student image uploads.
- Fictional data only until the university approves real identities/emails
  and public disclosure. Never present the demo as a real leaderboard.
- Never weaken or delete security tests to make CI pass. Do not merge
  security-critical PRs or deploy without the owner's explicit approval.

## Commands

```bash
npm ci
npm test                    # unit/frontend tests (fast)
npm run build:demo          # fictional demo build
npm run check:security      # production build + secret scans
npm run test:browser        # Chromium desktop/mobile smoke
npm run supabase:start && npm run supabase:reset   # local stack for iterating
npx --no-install supabase test db                  # pgTAP/RLS only (stack running)
npm run supabase:stop && npm run test:m2:local     # full live M2+M3 suite (needs stack stopped; slow)
node scripts/local-live-preview.mjs /abs/path/outside/repo.json  # manual QA (stack running)
```

## Layout and docs

- `supabase/migrations/` — append-only; never edit a merged migration.
- `supabase/tests/*.test.sql` — pgTAP; `tests/m2/` — live BFF/Auth integration.
- `functions/lib/` — session, CSRF, authorization, provider clients.
- Architecture: `docs/architecture/m2-auth-database.md`; threat model:
  `docs/security/threat-model.md`; roadmap: `docs/roadmap.md`;
  operations: `docs/operations/` (identity runbook, deployment, backup-restore, staff guide).

## Working style

Small verified batches, commit after each coherent change, targeted tests while
iterating, full suites at review gates. Keep `docs/progress.md` current and short.
