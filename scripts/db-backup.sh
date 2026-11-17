#!/usr/bin/env bash
# Encrypted data export and restore for Academic Arena (Supabase Free has no
# managed backups). Schema comes from supabase/migrations in Git; this file
# handles data only. Never write backups inside the repository.
#
#   scripts/db-backup.sh export  <local|linked> <output.sql.enc>
#   scripts/db-backup.sh restore <local|db-url-env> <input.sql.enc>
#
# The passphrase is read from the terminal (or AA_BACKUP_PASSPHRASE_FILE for
# the local drill) and never echoed. Store it in the custodian's password manager.
set -euo pipefail
umask 077

command=${1:-}; target=${2:-}; file=${3:-}
repo_root=$(cd "$(dirname "$0")/.." && pwd)
case "$file" in
  "" ) echo "usage: $0 export|restore <local|linked|db-url-env> <file.sql.enc>" >&2; exit 2 ;;
  "$repo_root"/*|./*|[!/]* ) echo "Backup files must use an absolute path outside the repository." >&2; exit 2 ;;
esac

passphrase_args=()
if [[ -n "${AA_BACKUP_PASSPHRASE_FILE:-}" ]]; then
  passphrase_args=(-pass "file:${AA_BACKUP_PASSPHRASE_FILE}")
fi
supabase() { (cd "$repo_root" && npx --no-install supabase "$@"); }
workdir=$(mktemp -d); trap 'rm -rf "$workdir"' EXIT

# Tables recreated by migrations are excluded so a restore into a freshly
# migrated database does not collide; the lifecycle gate stays at its default (off).
excludes=(-x auth.schema_migrations -x app_private.role_permissions -x app_private.runtime_controls)

if [[ "$command" == "export" ]]; then
  case "$target" in
    local) source_flag=(--local) ;;
    linked) source_flag=(--linked) ;;
    *) echo "export target must be local or linked" >&2; exit 2 ;;
  esac
  supabase db dump "${source_flag[@]}" --data-only -s auth,app_private,public "${excludes[@]}" -f "$workdir/data.sql" >/dev/null
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt "${passphrase_args[@]}" -in "$workdir/data.sql" -out "$file"
  shasum -a 256 "$file" > "$file.sha256"
  echo "Encrypted export written: $file (+ .sha256). Copy both offsite; keep the passphrase separate."
elif [[ "$command" == "restore" ]]; then
  shasum -a 256 -c "$file.sha256" >/dev/null
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 "${passphrase_args[@]}" -in "$file" -out "$workdir/data.sql"
  # The CLI runs one statement per call, so wrap the dump in one DO block. This
  # also makes the restore a single all-or-nothing transaction.
  tag="aa_restore_$(openssl rand -hex 12)"
  if grep -q "$tag" "$workdir/data.sql"; then echo "Dollar-quote tag collision; retry." >&2; exit 1; fi
  { printf 'DO $outer_%s$ BEGIN EXECUTE $%s$\n' "$tag" "$tag"; cat "$workdir/data.sql"; printf '\n$%s$; END $outer_%s$;\n' "$tag" "$tag"; } > "$workdir/restore.sql"
  mv "$workdir/restore.sql" "$workdir/data.sql"
  if [[ "$target" == "local" ]]; then
    supabase db query --local -f "$workdir/data.sql" >/dev/null
  else
    # target names an environment variable holding the target connection string,
    # so the URL never appears in shell history or process listings.
    db_url=${!target:?set $target to the freshly migrated target database URL}
    supabase db query --db-url "$db_url" -f "$workdir/data.sql" >/dev/null
  fi
  echo "Restore applied. Run the verification queries in docs/operations/backup-restore.md."
else
  echo "unknown command: $command" >&2; exit 2
fi
