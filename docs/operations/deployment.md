# Deployment and operations

Cloudflare Pages Free (static site + Pages Functions BFF) and Supabase Free.
$0/month. No paid add-ons, schedulers, monitoring, or domains.

## Environments

| | Supabase project | Pages environment | Data |
|---|---|---|---|
| Local | CLI native stack | `wrangler pages dev` | fictional, `ENVIRONMENT=test` (loopback only) |
| Staging | `academic-arena-staging` | Pages **preview** (non-`main` branches) | fictional only |
| Production | `academic-arena-prod` | Pages **production** (`main`) | approved data only |

Preview and production never share Supabase keys or session/rate-limit keys
(`configure-pages-secrets.sh` is run separately per environment).
`ENVIRONMENT` is `production` in both hosted environments, never `test`, so the
M2 account-lifecycle routes stay disabled (403) and the database lifecycle gate
stays off. Hosted provisioning/recovery/suspension/MFA-reset remain disabled
until they are verified on staging and separately approved.

## First deployment (owner steps marked ★)

1. ★ Create both Supabase Free projects; Authentication → disable "Allow new
   users to sign up"; keep email provider and TOTP MFA on.
2. ★ `npx supabase login` and `npx wrangler login` on the deploy machine.
3. Apply migrations (never the local seed):
   `npx supabase link --project-ref <ref>` then `npx supabase db push`.
   Verify: `select count(*) from cron.job` = 2 and
   `select allow_fictional_account_lifecycle from app_private.runtime_controls` = `false`.
4. Create the Pages project once:
   `npx wrangler pages project create academic-arena --production-branch main`.
5. Set `SUPABASE_URL` and `ENVIRONMENT=production` as plain environment
   variables for each environment (dashboard → Settings → Variables), and the
   secrets with `scripts/configure-pages-secrets.sh academic-arena <ref> production|preview`.
6. Build and deploy: `npm ci && npm run build:production &&
   npx wrangler pages deploy dist --project-name academic-arena --branch main`
   (use another `--branch` name for staging previews). The build refuses demo
   output for Cloudflare; production never includes fictional fixtures.
7. Smoke test the hosted site: `/api/public/catalog?level=5&semester=1` returns
   `{"groups":[],"modules":{}}` with `Cache-Control: private, no-store`; the home
   page shows the "no approved standings" empty state; `/api/staff/accounts`
   returns 401 anonymously and 403 for any hosted session.
8. ★ Bootstrap the first administrator (`identity-runbook.md` §1), then sign in,
   change the password, and enroll TOTP.

## Routine operations

- **Publish rankings:** see `staff-guide.md`. Every publication is a version;
  nothing is public until **Publish**.
- **Bad ranking publication:** Staff Desk → Publication history → *Roll back to
  this* on the last good version (atomic). Or **Withdraw live rankings** to show
  the empty state immediately. API responses are `no-store`, so no CDN copy
  outlives the change.
- **Takedown / temporary withdrawal:** Staff Desk → *Withdraw live rankings*
  (all standings) and Campus Wins → *Hide* (individual posts). Both take effect
  on the next request. For a full-site emergency, roll the Pages production
  deployment back to an earlier build or pause the Supabase project from its
  dashboard (the site then shows unavailable states, never stale data).
- **Bad application deployment:** Cloudflare dashboard → Pages → academic-arena
  → Deployments → previous production deployment → *Rollback to this
  deployment* (instant). JS/CSS use `Cache-Control: no-cache`, so browsers
  pick up the rollback on next load. Database migrations are forward-only:
  write a corrective migration rather than editing an applied one.
- **Migrations:** add a new timestamped file; run the full local suite;
  `npx supabase db push` to staging, verify, then production.

## Secret rotation

| Secret | How | Effect |
|---|---|---|
| `SESSION_JWE_KEY` | rerun `configure-pages-secrets.sh` (or `wrangler pages secret put`) and redeploy | everyone is signed out (old session rows cannot be decrypted) |
| `RATE_LIMIT_HMAC_KEY` | same | login throttle counters reset |
| Supabase secret/service key | Supabase dashboard → API keys → roll; then rerun the script | old key stops working immediately |
| Supabase anon/publishable key | same | none for users (BFF only) |
| Database password | Supabase dashboard → Database → reset | update the custodian's password manager; not used by the app |

Rotate immediately if a key may have leaked, when a custodian leaves, and at
least each academic year.

## Free-tier behaviour

- **Inactivity pause:** Supabase Free pauses after about a week without
  database activity. The site then shows "temporarily unavailable" states (the
  BFF fails closed with 503; no stale or demo data is substituted). Restore it
  from the Supabase dashboard (*Restore project*); data is kept. No artificial
  keep-alive traffic is used. While paused, pg_cron does not run, so expired
  encrypted temporary passwords are only erased after resume.
- **Quota exhaustion:** Cloudflare Functions (100k requests/day) or Supabase
  (database size, egress, Auth MAU) limits cause 5xx/429 responses, which the
  UI shows as unavailable. Check usage in both dashboards weekly during term;
  if limits approach, reduce publication frequency and do not upgrade without
  owner approval.
- **Outages:** public pages degrade to explicit unavailable/empty states;
  sign-in fails closed; no fictional fixtures are ever served in production.

## Backups

Supabase Free has no managed backups. Follow `backup-restore.md` weekly during
term and before every migration or bulk publication.
