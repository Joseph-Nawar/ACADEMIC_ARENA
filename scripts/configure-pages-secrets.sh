#!/usr/bin/env bash
# Loads Academic Arena server secrets into a Cloudflare Pages project's
# encrypted secret store without printing them. Requires `npx supabase login`
# and `npx wrangler login` by the owner first.
#
#   scripts/configure-pages-secrets.sh <pages-project> <supabase-project-ref> <production|preview>
#
# SESSION_JWE_KEY and RATE_LIMIT_HMAC_KEY are generated fresh (rotating them
# signs everyone out and resets rate-limit buckets, which is safe).
set -euo pipefail
umask 077
project=${1:?pages project name}; ref=${2:?supabase project ref}; environment=${3:?production or preview}
[[ "$environment" == production || "$environment" == preview ]] || { echo "environment must be production or preview" >&2; exit 2; }
[[ "$ref" =~ ^[a-z0-9]{20}$ ]] || { echo "unexpected Supabase project ref format" >&2; exit 2; }
cd "$(dirname "$0")/.."

put() { npx --no-install wrangler pages secret put "$1" --project-name "$project" --env "$environment" >/dev/null; }

keys_json=$(npx --no-install supabase projects api-keys --project-ref "$ref" -o json 2>/dev/null)
pick() {
  KEYS="$keys_json" python3 -c '
import json, os, sys
keys = json.loads(os.environ["KEYS"])
names = sys.argv[1:]
for wanted in names:
    for key in keys:
        if key.get("name") == wanted and key.get("api_key"):
            sys.stdout.write(key["api_key"]); sys.exit(0)
sys.exit("missing Supabase key: " + "/".join(names))
' "$@"
}

pick anon publishable | put SUPABASE_ANON_KEY
pick service_role secret | put SUPABASE_SERVICE_ROLE_KEY
openssl rand 32 | python3 -c 'import base64,sys; sys.stdout.write(base64.urlsafe_b64encode(sys.stdin.buffer.read()).decode().rstrip("="))' | put SESSION_JWE_KEY
openssl rand 32 | python3 -c 'import base64,sys; sys.stdout.write(base64.urlsafe_b64encode(sys.stdin.buffer.read()).decode().rstrip("="))' | put RATE_LIMIT_HMAC_KEY
unset keys_json
echo "Secrets set for $project ($environment). Values were not printed."
