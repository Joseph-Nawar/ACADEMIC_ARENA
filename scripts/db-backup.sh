#!/usr/bin/env bash
# Encrypted data export and restore for Academic Arena (Supabase Free has no
# managed backups). Schema comes from supabase/migrations in Git; this file
# handles data only. Never write backups inside the repository.
#
#   scripts/db-backup.sh export  <local|linked> <output.aabk>
#   scripts/db-backup.sh restore <local|linked> <input.aabk>
#
# "linked" is the project selected with `npx supabase link --project-ref <ref>`;
# restore through the Management API, so no database URL or password appears in
# process arguments. The passphrase is read with a hidden prompt (or from the
# 0600 file named by AA_BACKUP_PASSPHRASE_FILE for the local drill) and passed to
# Node only through the environment. Encryption: scrypt + AES-256-GCM.
set -euo pipefail
umask 077

command=${1:-}; target=${2:-}; file=${3:-}
repo_root=$(cd "$(dirname "$0")/.." && pwd -P)
[[ "$command" == export || "$command" == restore ]] || { echo "usage: $0 export|restore <local|linked> <absolute-file>" >&2; exit 2; }
[[ "$target" == local || "$target" == linked ]] || { echo "target must be local or linked" >&2; exit 2; }
[[ "$file" == /* ]] || { echo "Use an absolute backup path outside the repository." >&2; exit 2; }
file_dir=$(cd "$(dirname "$file")" && pwd -P)
case "$file_dir/" in "$repo_root"/*) echo "Backup files must be outside the repository." >&2; exit 2 ;; esac
file="$file_dir/$(basename "$file")"

if [[ -n "${AA_BACKUP_PASSPHRASE_FILE:-}" ]]; then
  AA_BACKUP_PASSPHRASE=$(cat "$AA_BACKUP_PASSPHRASE_FILE")
else
  read -rs -p "Backup passphrase: " AA_BACKUP_PASSPHRASE; echo >&2
fi
export AA_BACKUP_PASSPHRASE

supabase() { (cd "$repo_root" && npx --no-install supabase "$@"); }
workdir=$(mktemp -d); trap 'rm -rf "$workdir"' EXIT
flag=(--"$target")

# Live credentials and transient state are never exported: refresh tokens,
# provider and BFF sessions, MFA challenges, one-time tokens, and rate-limit
# buckets. Tables recreated by migrations are excluded too, so the restore
# applies cleanly and the lifecycle gate stays at its default (off).
excludes=(
  -x auth.schema_migrations -x auth.refresh_tokens -x auth.sessions -x auth.mfa_amr_claims
  -x auth.mfa_challenges -x auth.one_time_tokens -x auth.flow_state -x auth.audit_log_entries
  -x auth.saml_relay_states
  -x app_private.bff_sessions -x app_private.login_rate_limit_buckets
  -x app_private.role_permissions -x app_private.runtime_controls
)

if [[ "$command" == export ]]; then
  [[ ! -e "$file" ]] || { echo "Refusing to overwrite $file" >&2; exit 2; }
  supabase db dump "${flag[@]}" --data-only -s auth,app_private,public "${excludes[@]}" -f "$workdir/data.sql" >/dev/null 2>&1 \
    || { echo "Export failed (details suppressed to avoid printing data)." >&2; exit 1; }
  node "$repo_root/scripts/backup-crypto.mjs" encrypt "$workdir/data.sql" "$file"
  (cd "$file_dir" && shasum -a 256 "$(basename "$file")" > "$(basename "$file").sha256")
  echo "Encrypted export written: $file (+ .sha256 for transfer integrity). Copy both offsite."
else
  (cd "$file_dir" && shasum -a 256 -c "$(basename "$file").sha256" >/dev/null)
  node "$repo_root/scripts/backup-crypto.mjs" decrypt "$file" "$workdir/data.sql"
  # The CLI runs one statement per call, so wrap the dump in one DO block. This
  # also makes the restore a single all-or-nothing transaction.
  tag="aa_restore_$(openssl rand -hex 12)"
  if grep -q "$tag" "$workdir/data.sql"; then echo "Dollar-quote tag collision; retry." >&2; exit 1; fi
  { printf 'DO $outer_%s$ BEGIN EXECUTE $%s$\n' "$tag" "$tag"; cat "$workdir/data.sql"; printf '\n$%s$; END $outer_%s$;\n' "$tag" "$tag"; } > "$workdir/restore.sql"
  supabase db query "${flag[@]}" -f "$workdir/restore.sql" >/dev/null 2>&1 \
    || { echo "Restore failed and was rolled back (details suppressed to avoid printing data)." >&2; exit 1; }
  echo "Restore applied. Run the verification query in docs/operations/backup-restore.md."
fi
