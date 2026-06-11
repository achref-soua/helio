#!/bin/sh
# Helio backup sidecar (ADR-0020). Modes:
#   daemon          — nightly backup at BACKUP_TIME (default 03:30 UTC) and
#                     a 15s poll of the backup_request table for run-now
#   run [label]     — one backup now (the CLI's pre-update hook uses this)
#   restore <file>  — pg_restore --clean a dump from /backups (CLI-driven)
#   prune           — apply the retention policy
#
# Dumps: pg_dump custom format (-Fc, compressed), written atomically,
# sha256-summed, optionally passphrase-encrypted (BACKUP_PASSPHRASE →
# openssl aes-256-cbc -pbkdf2). Every run gets a backup_run row via psql
# on the admin connection — the same credential pg_dump itself needs.
# Retention: keep the newest BACKUP_KEEP (default 14); 'pre-update'
# backups additionally keep their newest 5 regardless.
set -eu

# Bind mounts arrive owned by the host user; take ownership once, then
# drop privileges for everything that touches the database or the dumps.
if [ "$(id -u)" = "0" ]; then
  chown postgres:postgres "${BACKUP_DIR:-/backups}" 2>/dev/null || true
  exec su-exec postgres "$0" "$@"
fi

: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
BACKUP_TIME="${BACKUP_TIME:-03:30}"

sql() {
  psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -qAt -c "$1"
}

sql_quiet() {
  psql "$DATABASE_ADMIN_URL" -qAt -c "$1" 2>/dev/null || true
}

esc() {
  printf %s "$1" | sed "s/'/''/g"
}

record_failure() {
  # Best-effort: postgres itself may be the thing that's down.
  sql_quiet "UPDATE backup_run SET status='FAILED', finished_at=now(), error='$(esc "$2")' WHERE id='$1'"
  printf '{"at":"%s","error":"%s"}\n' "$(date -u +%FT%TZ)" "$2" >"$BACKUP_DIR/.last-failure.json" 2>/dev/null || true
}

run_backup() {
  label="${1:-scheduled}"
  id="bk_$(date -u +%s%N)"
  stamp=$(date -u +%Y%m%d-%H%M%S)
  base="helio-${stamp}-${label}.dump"
  tmp="$BACKUP_DIR/.${base}.tmp"
  final="$BACKUP_DIR/$base"

  # Free-space preflight: require headroom of 2× the previous dump.
  last_size=$(ls -l "$BACKUP_DIR"/helio-*.dump* 2>/dev/null | awk '{s=$5} END {print s+0}')
  free=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4 * 1024}')
  need=$((last_size * 2))
  if [ "$need" -gt 0 ] && [ "$free" -lt "$need" ]; then
    sql_quiet "INSERT INTO backup_run (id, filename, label, status, error) VALUES ('$id', '$base', '$(esc "$label")', 'FAILED', 'low disk: need ~$need bytes, have $free')"
    echo "backup skipped: low disk" >&2
    return 1
  fi

  sql "INSERT INTO backup_run (id, filename, label, status, app_version) VALUES ('$id', '$base', '$(esc "$label")', 'RUNNING', '$(esc "${HELIO_VERSION:-dev}")')" \
    || { echo "could not record the backup run" >&2; return 1; }

  if ! pg_dump -Fc -Z6 -d "$DATABASE_ADMIN_URL" -f "$tmp"; then
    rm -f "$tmp"
    record_failure "$id" "pg_dump failed"
    return 1
  fi
  sync
  mv "$tmp" "$final"

  if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    if openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
      -pass env:BACKUP_PASSPHRASE -in "$final" -out "${final}.enc"; then
      rm -f "$final"
      final="${final}.enc"
      base="${base}.enc"
    else
      record_failure "$id" "encryption failed"
      return 1
    fi
  fi

  sha256sum "$final" | awk '{print $1}' >"${final}.sha256"
  size=$(wc -c <"$final" | tr -d ' ')
  digest=$(cat "${final}.sha256")
  encrypted=$([ -n "${BACKUP_PASSPHRASE:-}" ] && echo true || echo false)
  sql "UPDATE backup_run SET status='OK', finished_at=now(), filename='$base', size_bytes=$size, sha256='$digest', encrypted=$encrypted WHERE id='$id'"
  rm -f "$BACKUP_DIR/.last-failure.json" 2>/dev/null || true
  echo "backup ok: $base ($size bytes)"
  prune_backups
}

prune_backups() {
  # Newest BACKUP_KEEP stay; pre-update dumps keep their newest 5 too.
  keep_list=$(
    { ls -t "$BACKUP_DIR"/helio-*.dump "$BACKUP_DIR"/helio-*.dump.enc 2>/dev/null | head -n "$BACKUP_KEEP";
      ls -t "$BACKUP_DIR"/helio-*-pre-update.dump "$BACKUP_DIR"/helio-*-pre-update.dump.enc 2>/dev/null | head -n 5; } | sort -u
  )
  for file in "$BACKUP_DIR"/helio-*.dump "$BACKUP_DIR"/helio-*.dump.enc; do
    [ -e "$file" ] || continue
    if ! printf '%s\n' "$keep_list" | grep -qxF "$file"; then
      rm -f "$file" "${file}.sha256"
      sql_quiet "UPDATE backup_run SET status='PRUNED' WHERE filename='$(esc "$(basename "$file")")' AND status='OK'"
      echo "pruned $(basename "$file")"
    fi
  done
}

restore_backup() {
  file="$BACKUP_DIR/$1"
  [ -f "$file" ] || { echo "no such backup: $1" >&2; exit 1; }
  echo "restoring $1 …"
  pg_restore --clean --if-exists --no-owner -d "$DATABASE_ADMIN_URL" "$file"
  echo "restore complete"
}

serve_requests() {
  rows=$(sql_quiet "UPDATE backup_request SET picked_up_at=now() WHERE picked_up_at IS NULL RETURNING label")
  if [ -n "$rows" ]; then
    printf '%s\n' "$rows" | while IFS= read -r label; do
      [ -n "$label" ] && run_backup "$label" || true
    done
  fi
}

daemon() {
  echo "helio-backup ${HELIO_VERSION:-dev} — nightly at ${BACKUP_TIME} UTC, keep ${BACKUP_KEEP}"
  last_day=""
  while :; do
    now_time=$(date -u +%H:%M)
    today=$(date -u +%F)
    if [ "$now_time" = "$BACKUP_TIME" ] && [ "$last_day" != "$today" ]; then
      last_day="$today"
      run_backup scheduled || true
    fi
    serve_requests
    sleep 15
  done
}

case "${1:-daemon}" in
  daemon) daemon ;;
  run) run_backup "${2:-manual}" ;;
  restore) restore_backup "${2:?usage: restore <filename>}" ;;
  prune) prune_backups ;;
  *) echo "usage: backup.sh daemon|run [label]|restore <file>|prune" >&2; exit 1 ;;
esac
