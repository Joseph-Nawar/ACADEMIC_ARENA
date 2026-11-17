#!/usr/bin/env bash
# Loads Academic Arena server configuration into a Cloudflare Pages project's
# encrypted secret store without printing it. Requires the owner to have run
# `npx supabase login` and `npx wrangler login`.
#
#   scripts/configure-pages-secrets.sh <pages-project> <supabase-project-ref>
#
# `wrangler pages secret put` writes the project's production environment only,
# so staging and production use separate Pages projects (academic-arena-staging
# and academic-arena), each paired with its own Supabase project. Preview
# deployments receive no secrets and fail closed (503).
# SESSION_JWE_KEY and RATE_LIMIT_HMAC_KEY are generated fresh: rerunning this
# signs everyone out and resets login throttles, which is safe. Redeploy after
# running it; Pages applies secrets to new deployments.
set -euo pipefail
umask 077
project=${1:?pages project name}; ref=${2:?supabase project ref}
[[ "$project" =~ ^academic-arena(-staging)?$ ]] || { echo "unexpected Pages project name" >&2; exit 2; }
[[ "$ref" =~ ^[a-z0-9]{20}$ ]] || { echo "unexpected Supabase project ref format" >&2; exit 2; }
cd "$(dirname "$0")/.."

put() { npx --no-install wrangler pages secret put "$1" --project-name "$project" >/dev/null 2>&1 || { echo "failed to set $1" >&2; exit 1; }; }

keys_json=$(npx --no-install supabase projects api-keys --project-ref "$ref" --reveal -o json 2>/dev/null) \
  || { echo "could not read Supabase API keys (is the CLI logged in?)" >&2; exit 1; }
pick() {
  KEYS="$keys_json" python3 -c '
import json, os, re, sys
keys = json.loads(os.environ["KEYS"])
role = sys.argv[1]
modern = "publishable" if role == "public" else "secret"
legacy = "anon" if role == "public" else "service_role"
pattern = r"^sb_(publishable|secret)_[A-Za-z0-9_-]{20,}$|^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$"
candidates = [k for k in keys if k.get("type") == modern] + [k for k in keys if k.get("name") == legacy]
for key in candidates:
    value = key.get("api_key") or ""
    if re.match(pattern, value):
        sys.stdout.write(value); sys.exit(0)
sys.exit("no usable unmasked " + modern + "/" + legacy + " key found")
' "$1"
}

printf 'https://%s.supabase.co' "$ref" | put SUPABASE_URL
printf 'production' | put ENVIRONMENT
pick public | put SUPABASE_ANON_KEY
pick server | put SUPABASE_SERVICE_ROLE_KEY
openssl rand 32 | python3 -c 'import base64,sys; sys.stdout.write(base64.urlsafe_b64encode(sys.stdin.buffer.read()).decode().rstrip("="))' | put SESSION_JWE_KEY
openssl rand 32 | python3 -c 'import base64,sys; sys.stdout.write(base64.urlsafe_b64encode(sys.stdin.buffer.read()).decode().rstrip("="))' | put RATE_LIMIT_HMAC_KEY
unset keys_json
names=$(npx --no-install wrangler pages secret list --project-name "$project" 2>/dev/null | grep -oE 'SUPABASE_URL|ENVIRONMENT|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|SESSION_JWE_KEY|RATE_LIMIT_HMAC_KEY' | sort -u | wc -l | tr -d ' ')
[[ "$names" == 6 ]] || { echo "expected 6 secrets on $project, found $names" >&2; exit 1; }
echo "All 6 settings stored for $project (values not printed). Redeploy to apply."
