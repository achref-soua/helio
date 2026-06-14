#!/bin/sh
# Helio in-app update sidecar.
#
# This is the ONLY container that holds the Docker socket. It exists so the
# dashboard's owner can trigger a one-click update without giving the web
# app host-root. Its blast radius is deliberately tiny:
#
#   * It only ever runs the FIXED command `helio update` — the request file
#     the web app drops carries NO command, just an optional version tag and
#     a shared secret. There is no path from the request to arbitrary exec.
#   * `serve` watches a shared volume for a secret-guarded request and, on a
#     valid one, launches a DETACHED, PROJECT-LESS `worker` container. Being
#     project-less is what lets it survive the `compose down` that the update
#     performs on the rest of the stack (including this sidecar and the web
#     app) and then recreate everything.
#   * `worker` runs `helio update --yes`, streaming coarse progress to
#     status.json so the dashboard can report it across the restart, and
#     reads the resulting version from the install manifest (NOT from its own
#     baked `helio --version`, which is the pre-update build).
#
# Disable the whole thing by dropping the `update` compose profile (no
# sidecar, no socket) or setting HELIO_INAPP_UPDATE=false (the button hides).

set -u

STATE_DIR="${HELIO_STATE_DIR:-/state}"
HELIO_HOME_DIR="${HELIO_HOME:-/helio-home}"
COMPOSE_PROJECT="${HELIO_COMPOSE_PROJECT:-helio-selfhost}"
POLL_SECONDS="${HELIO_UPDATE_POLL_SECONDS:-5}"
REQUEST_FILE="$STATE_DIR/request.json"
STATUS_FILE="$STATE_DIR/status.json"
LOG_FILE="$STATE_DIR/update.log"
WORKER_NAME="${HELIO_UPDATE_WORKER_NAME:-helio-update-worker}"

log() { printf '%s updater: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

# Escape a string for embedding inside a JSON double-quoted value.
json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\t' '  '
}

# Read one flat string field ("key":"value") out of a small JSON blob. The
# only fields we read — secret, target, nonce — are constrained strings the
# web app validates before writing; this never needs to be a real parser.
json_field() {
  printf '%s' "$1" | tr -d '\n' |
    sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

# Atomically publish the job status the dashboard polls.
write_status() {
  _phase="$1"
  _version="$2"
  _target="$3"
  _message="$4"
  _now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  _tmp="$STATE_DIR/.status.$$"
  cat >"$_tmp" <<EOF
{
  "phase": "$_phase",
  "version": "$(json_escape "$_version")",
  "targetVersion": "$(json_escape "$_target")",
  "message": "$(json_escape "$_message")",
  "updatedAt": "$_now"
}
EOF
  mv -f "$_tmp" "$STATUS_FILE" 2>/dev/null || cp "$_tmp" "$STATUS_FILE"
  chmod 0664 "$STATUS_FILE" 2>/dev/null || true
}

# ── serve mode ──────────────────────────────────────────────────────────────

self_container_id() {
  docker ps -q \
    -f "label=com.docker.compose.project=$COMPOSE_PROJECT" \
    -f "label=com.docker.compose.service=updater" 2>/dev/null | head -n1
}

# The daemon-visible source for one of our own mounts: a named volume's name
# (project-prefixed) when it has one, else a bind's host source. Reusing what
# the daemon already resolved for THIS container's compose mounts is what
# makes the worker's bind mounts correct on Linux, macOS, and Docker Desktop
# (WSL2/Windows) alike — we never re-translate a host path.
mount_source() {
  docker inspect -f \
    "{{ range .Mounts }}{{ if eq .Destination \"$2\" }}{{ if .Name }}{{ .Name }}{{ else }}{{ .Source }}{{ end }}{{ end }}{{ end }}" \
    "$1" 2>/dev/null
}

launch_worker() {
  _target="$1"
  _self="$(self_container_id)"
  if [ -z "$_self" ]; then
    log "could not locate my own container (project=$COMPOSE_PROJECT) — refusing to launch"
    write_status failed "" "$_target" "The updater could not locate its own container."
    return 0
  fi
  _home_src="$(mount_source "$_self" "$HELIO_HOME_DIR")"
  _state_src="$(mount_source "$_self" "$STATE_DIR")"
  if [ -z "$_home_src" ] || [ -z "$_state_src" ]; then
    log "could not resolve mount sources (home='$_home_src' state='$_state_src')"
    write_status failed "" "$_target" "The updater could not resolve its mount sources."
    return 0
  fi

  write_status starting "" "$_target" "Launching the update…"
  log "launching detached worker via $HELIO_UPDATER_IMAGE (target=${_target:-latest})"
  # Detached + project-less + --rm. Project-less so the `compose down` inside
  # the update can't stop it; --rm so it tidies up after exiting.
  #
  # The install dir is mounted at its REAL host path (mount-at-same-path), not
  # a fixed /helio-home: `helio update`'s compose file uses relative binds
  # (e.g. ./backups) resolved against the compose-file directory, and the
  # daemon must see those as host paths. Mounting source==destination makes
  # the worker's view of the path identical to the daemon's, on Linux and on
  # Docker Desktop (WSL2/Windows) alike.
  if ! _out="$(docker run -d --rm \
    --name "$WORKER_NAME" \
    -e HELIO_HOME="$_home_src" \
    -e HELIO_STATE_DIR="$STATE_DIR" \
    -e HELIO_COMPOSE_PROJECT="$COMPOSE_PROJECT" \
    -e HELIO_UPDATE_TARGET="$_target" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$_home_src:$_home_src" \
    -v "$_state_src:$STATE_DIR" \
    "$HELIO_UPDATER_IMAGE" worker 2>&1)"; then
    log "failed to launch worker: $_out"
    write_status failed "" "$_target" "Could not launch the update worker. $_out"
  fi
}

handle_request() {
  # Consume the request immediately so a crash can never re-run it.
  _req="$(cat "$REQUEST_FILE" 2>/dev/null || true)"
  rm -f "$REQUEST_FILE"
  [ -n "$_req" ] || return 0

  if [ "$(json_field "$_req" secret)" != "$HELIO_UPDATE_SECRET" ]; then
    log "rejected update request: invalid secret"
    write_status failed "" "" "Rejected: the update request was not authorized."
    return 0
  fi

  _target="$(json_field "$_req" target)"
  if [ -n "$_target" ] &&
    ! printf '%s' "$_target" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$'; then
    log "rejected update request: invalid target '$_target'"
    write_status failed "" "$_target" "Rejected: '$_target' is not a valid version."
    return 0
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$WORKER_NAME"; then
    log "an update worker is already running — ignoring request"
    return 0
  fi

  launch_worker "$_target"
}

serve() {
  : "${HELIO_UPDATE_SECRET:?serve mode requires HELIO_UPDATE_SECRET}"
  : "${HELIO_UPDATER_IMAGE:?serve mode requires HELIO_UPDATER_IMAGE}"
  mkdir -p "$STATE_DIR"
  # The web app runs as a non-root user; let it drop a request here. The
  # volume is shared only by Helio's own (trusted) containers.
  chmod 0777 "$STATE_DIR" 2>/dev/null || true
  trap 'log "stopping"; exit 0' TERM INT
  log "online — watching $REQUEST_FILE (project=$COMPOSE_PROJECT)"
  while true; do
    [ -f "$REQUEST_FILE" ] && handle_request
    sleep "$POLL_SECONDS" &
    wait $!
  done
}

# ── worker mode ─────────────────────────────────────────────────────────────

# The version the update actually landed on: the manifest it just wrote, not
# this worker image's baked `helio --version` (that is the pre-update build).
installed_version() {
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$HELIO_HOME_DIR/manifest.json" 2>/dev/null | head -n1
}

# Best-effort: map helio's own progress lines to coarse phases. Unknown lines
# leave the phase untouched, so a wording change only loses granularity.
phase_tailer() {
  tail -f "$LOG_FILE" 2>/dev/null | while IFS= read -r _line; do
    case "$_line" in
      *"pre-update backup"*) write_status running "" "$1" "Backing up before the update…" ;;
      *"stopping services"*) write_status running "" "$1" "Stopping services…" ;;
      *"pulling the new images"*) write_status running "" "$1" "Downloading the new release…" ;;
      *"database migrations"*) write_status running "" "$1" "Applying database migrations…" ;;
      *"failed to start"* | *"migrations failed"*) : ;;
      *" is up at "*) write_status running "" "$1" "Starting services…" ;;
    esac
  done
}

worker() {
  : "${HELIO_HOME_DIR:?worker requires HELIO_HOME}"
  _target="${HELIO_UPDATE_TARGET:-}"
  log "worker starting (home=$HELIO_HOME_DIR target=${_target:-latest})"
  write_status running "" "$_target" "Starting the update…"

  : >"$LOG_FILE"
  phase_tailer "$_target" &
  _tailer=$!

  # --no-self-update: this worker's `helio` is the image's baked binary, not
  # a user install, so refreshing it is pointless (and it is --rm anyway).
  if [ -n "$_target" ]; then
    HELIO_HOME="$HELIO_HOME_DIR" helio update --yes --no-self-update --version "$_target" >>"$LOG_FILE" 2>&1
    _code=$?
  else
    HELIO_HOME="$HELIO_HOME_DIR" helio update --yes --no-self-update >>"$LOG_FILE" 2>&1
    _code=$?
  fi

  kill "$_tailer" 2>/dev/null || true
  wait "$_tailer" 2>/dev/null || true

  if [ "$_code" -eq 0 ]; then
    _new="$(installed_version)"
    log "update finished — now ${_new:-unknown}"
    write_status done "$_new" "$_target" "Updated to ${_new:-the latest release}."
  else
    _tail="$(tail -n 12 "$LOG_FILE" 2>/dev/null | tr '\n' ' ')"
    log "update failed (exit $_code)"
    write_status failed "" "$_target" "Update failed (exit $_code). A pre-update backup was taken; check the server logs. $_tail"
  fi
}

# ── entry ───────────────────────────────────────────────────────────────────

# Tests source this file with HELIO_UPDATER_SOURCED=1 to exercise the helper
# functions in isolation (with a stubbed `docker`), without running a mode.
[ -n "${HELIO_UPDATER_SOURCED:-}" ] && return 0

case "${1:-serve}" in
  serve) serve ;;
  worker) worker ;;
  *)
    log "unknown mode '${1:-}'. Usage: updater.sh [serve|worker]"
    exit 2
    ;;
esac
