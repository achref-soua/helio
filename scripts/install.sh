#!/bin/sh
# Helio — install and operate a self-hosted Helio with one script.
#
# No compiled binary (nothing for antivirus/SmartScreen to flag) and no Docker
# commands to learn: this script drives Docker Compose for you. It installs
# Docker on Linux if it is missing, downloads the pinned release bundle, checks
# its checksum, generates this install's secrets, and brings the stack up.
#
# Quickstart (Mac/Linux/WSL):
#   curl -fsSL https://raw.githubusercontent.com/achref-soua/helio/main/scripts/install.sh | sh
#
# Or download it and run a command:
#   ./install.sh                 # interactive menu
#   ./install.sh install [--full] [--version vX.Y.Z] [--yes]
#   ./install.sh update | uninstall | start | stop | status | logs
#
# Windows: use install.ps1 (or run this under WSL).
set -eu

REPO="${HELIO_REPO:-achref-soua/helio}"
HELIO_HOME="${HELIO_HOME:-$HOME/.helio}"
COMPOSE_FILE="$HELIO_HOME/docker-compose.yml"
ENV_FILE="$HELIO_HOME/.env"
MANIFEST_FILE="$HELIO_HOME/manifest.json"
# Where to (re)fetch this script for the `helio` command and for self-update.
SELF_URL="${HELIO_SELF_URL:-https://github.com/$REPO/releases/latest/download/install.sh}"

# ── output ──────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  esc=$(printf '\033')
  Y="${esc}[93m"; B="${esc}[1m"; D="${esc}[2m"; G="${esc}[92m"; R="${esc}[0m"
else
  Y=''; B=''; D=''; G=''; R=''
fi
say()  { printf '%s\n' "$1"; }
step() { printf '\n%s──%s %s%s%s\n' "$Y" "$R" "$B" "$1" "$R"; }
ok()   { printf '%s   ok%s %s\n' "$G" "$R" "$1"; }
warn() { printf '! %s\n' "$1" >&2; }
die()  { printf 'error: %s\n' "$1" >&2; exit 1; }

# ── small helpers ───────────────────────────────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }

fetch() { # url dest
  if have curl; then curl -fsSL "$1" -o "$2" || die "download failed: $1"
  elif have wget; then wget -qO "$2" "$1" || die "download failed: $1"
  else die "need curl or wget to download"; fi
}

http_ok() { # url -> 0 if 2xx
  if have curl; then curl -fsS -o /dev/null "$1" 2>/dev/null
  elif have wget; then wget -q -O /dev/null "$1" 2>/dev/null
  else return 1; fi
}

sha256_of() {
  if have sha256sum; then sha256sum "$1" | awk '{print $1}'
  elif have shasum; then shasum -a 256 "$1" | awk '{print $1}'
  else die "no sha256 tool found (sha256sum or shasum)"; fi
}

open_browser() {
  case "$(uname -s)" in
    Darwin) have open && open "$1" >/dev/null 2>&1 || true ;;
    Linux)  have xdg-open && xdg-open "$1" >/dev/null 2>&1 || true ;;
  esac
}

# Save this script as ~/.helio/helio so day-2 ops are `helio <command>` (still
# a plain script — nothing for antivirus to flag). Copies itself when run from
# a file; re-fetches the release asset when run via `curl | sh`.
self_install() {
  dest="$HELIO_HOME/helio"
  if [ -f "$0" ]; then cp "$0" "$dest" 2>/dev/null || fetch "$SELF_URL" "$dest" 2>/dev/null || return 0
  else fetch "$SELF_URL" "$dest" 2>/dev/null || return 0; fi
  chmod +x "$dest" 2>/dev/null || true
}

# ── secret generation (matches the CLI's secret kinds) ──────────────────────
# HEX32/HEX24 = N random bytes hex; PASSWORD = 24 bytes base64url (URL-safe for
# connection strings); B64 = 32 bytes standard base64 (the AES-256 vault key).
# VAPID (web-push) needs a P-256 keypair that is painful in pure shell and is
# optional, so it is left empty — configure web push later from the dashboard.
gen_secret() {
  have openssl || die "openssl is required to generate secrets"
  case "$1" in
    HEX32)    openssl rand -hex 32 ;;
    HEX24)    openssl rand -hex 24 ;;
    PASSWORD) openssl rand -base64 24 | tr '+/' '-_' | tr -d '=' ;;
    B64)      openssl rand -base64 32 ;;
    VAPID)    printf '' ;;
    *)        die "unknown secret kind: $1" ;;
  esac
}

# Replace every __GENERATE_<KIND>_<NAME>__ marker in $1 with a fresh secret,
# writing the result to $2 with 0600 perms.
fill_env() { # template out
  cp "$1" "$2"
  for marker in $(grep -oE '__GENERATE_[A-Z0-9_]+__' "$1" | sort -u); do
    kind=$(printf '%s' "$marker" | sed -E 's/^__GENERATE_([A-Z0-9]+)_.*$/\1/')
    value=$(gen_secret "$kind")
    # Secrets are [A-Za-z0-9+/=_-] only — none of |, & or \ — so a piped
    # sed substitution is safe; escape defensively anyway.
    value=$(printf '%s' "$value" | sed -e 's/[&|\\]/\\&/g')
    sed "s|$marker|$value|g" "$2" > "$2.tmp" && mv "$2.tmp" "$2"
  done
  chmod 600 "$2"
}

get_env() { [ -f "$ENV_FILE" ] && grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

set_env() { # key value
  if grep -q "^$1=" "$ENV_FILE" 2>/dev/null; then
    sed "s|^$1=.*|$1=$2|" "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}

# Append keys present in the new template but not in the live .env (filling any
# markers) — the same append-only contract `helio update` uses, so an operator's
# edits are never overwritten.
merge_new_env_keys() { # new_template
  added=''
  while IFS= read -r line; do
    case "$line" in '#'*|'') continue ;; esac
    key=$(printf '%s' "$line" | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p')
    [ -n "$key" ] || continue
    grep -q "^$key=" "$ENV_FILE" && continue
    while printf '%s' "$line" | grep -q '__GENERATE_'; do
      marker=$(printf '%s' "$line" | grep -oE '__GENERATE_[A-Z0-9_]+__' | head -1)
      kind=$(printf '%s' "$marker" | sed -E 's/^__GENERATE_([A-Z0-9]+)_.*$/\1/')
      value=$(gen_secret "$kind" | sed -e 's/[&|\\]/\\&/g')
      line=$(printf '%s' "$line" | sed "s|$marker|$value|")
    done
    printf '%s\n' "$line" >> "$ENV_FILE"
    added="$added $key"
  done < "$1"
  [ -n "$added" ] && say "  new settings added to .env:$added" || true
}

# ── docker + compose ────────────────────────────────────────────────────────
ensure_docker() {
  if ! have docker; then
    case "$(uname -s)" in
      Linux)
        warn "Docker is not installed."
        if [ -t 0 ] && [ "${HELIO_YES:-}" != "1" ]; then
          printf 'Install Docker Engine now? It runs the official get.docker.com script (needs sudo). [y/N]: '
          read -r reply
          case "$reply" in y|Y|yes) ;; *) die "Install Docker, then re-run: https://docs.docker.com/engine/install/" ;; esac
        elif [ "${HELIO_YES:-}" != "1" ]; then
          die "Docker is required. Install it (https://docs.docker.com/engine/install/) or re-run with HELIO_YES=1 to auto-install."
        fi
        fetch "https://get.docker.com" "$HELIO_HOME/get-docker.sh" || die "could not download the Docker installer"
        sh "$HELIO_HOME/get-docker.sh" || die "Docker installation failed"
        ;;
      Darwin) die "Install Docker Desktop (https://docs.docker.com/desktop/setup/install/mac-install/) or OrbStack, start it, then re-run." ;;
      *) die "Install Docker, then re-run: https://docs.docker.com/engine/install/" ;;
    esac
  fi
  docker info >/dev/null 2>&1 || die "Docker is installed but its daemon isn't running — start Docker, then re-run."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 (the 'docker compose' plugin) is missing."
}

compose() { ( cd "$HELIO_HOME" && docker compose --file "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@" ); }

manifest_version() {
  [ -f "$MANIFEST_FILE" ] || { printf 'v0.0.0'; return; }
  grep -o '"version"[^,]*' "$MANIFEST_FILE" | head -1 | sed -E 's/.*"version"[^"]*"([^"]+)".*/\1/'
}

resolve_tag() { # echoes vX.Y.Z
  if [ -n "${VERSION:-}" ]; then tag="$VERSION"; else
    fetch "https://api.github.com/repos/$REPO/releases/latest" "$HELIO_HOME/.latest.json"
    tag=$(grep -o '"tag_name"[^,]*' "$HELIO_HOME/.latest.json" | head -1 | sed -E 's/.*"tag_name"[^"]*"([^"]+)".*/\1/')
    rm -f "$HELIO_HOME/.latest.json"
  fi
  [ -n "$tag" ] || die "could not resolve the release version"
  case "$tag" in v*) ;; *) tag="v$tag" ;; esac
  printf '%s' "$tag"
}

download_bundle() { # tag -> extracts compose + .env.template + manifest into $HELIO_HOME
  tag="$1"
  mkdir -p "$HELIO_HOME/releases"
  bundle="$HELIO_HOME/releases/helio-bundle-$tag.tar.gz"
  sums="$HELIO_HOME/releases/checksums-$tag.txt"
  base="https://github.com/$REPO/releases/download/$tag"
  fetch "$base/helio-bundle-$tag.tar.gz" "$bundle"
  fetch "$base/checksums.txt" "$sums"
  want=$(awk -v f="helio-bundle-$tag.tar.gz" '$2==f {print $1}' "$sums")
  [ -n "$want" ] || die "no checksum for the bundle in checksums.txt"
  got=$(sha256_of "$bundle")
  [ "$want" = "$got" ] || die "bundle checksum mismatch (expected $want, got $got) — refusing to install"
  ok "bundle $tag verified (sha256 matches)"
  tar -xzf "$bundle" -C "$HELIO_HOME"
}

bring_up() { # profile
  prof="$1"
  step "Pulling images (the first install downloads 1-2 GB)"
  compose --profile "$prof" pull || die "image pull failed — is this release published?"
  step "Starting databases"
  compose up -d --wait postgres redis mailpit || die "datastores failed to start (try: $0 logs)"
  step "Preparing the database"
  compose --profile ops run --rm migrate deploy || die "database migration failed (try: $0 logs)"
  step "Starting Helio"
  compose --profile "$prof" up -d --wait || die "services did not become healthy (try: $0 status)"
}

wait_healthy() {
  url=$(get_env APP_URL); [ -n "$url" ] || url="http://localhost:3000"
  i=0
  while [ "$i" -lt 60 ]; do
    http_ok "$url/api/healthz" && return 0
    i=$((i + 1)); sleep 2
  done
  return 1
}

print_ready() {
  url=$(get_env APP_URL); [ -n "$url" ] || url="http://localhost:3000"
  mp=$(get_env MAILPIT_UI_PORT); [ -n "$mp" ] || mp=8025
  say ''
  say "${Y}  Helio is up.${R}"
  say ''
  say "  dashboard   ${B}$url${R}"
  say "  test inbox  http://localhost:$mp"
  say "  manage      ${B}$HELIO_HOME/helio${R} status | update | stop"
  say "  ${D}tip: add $HELIO_HOME to your PATH to just run 'helio …'${R}"
  say ''
  say "Open the dashboard and create the first account — it becomes the administrator."
  say "${D}The setup screen can load sample data so you can explore a full product right away.${R}"
}

# ── commands ────────────────────────────────────────────────────────────────
cmd_install() {
  step "Checking Docker"; ensure_docker; ok "Docker is installed and running"
  [ -f "$MANIFEST_FILE" ] && die "Helio is already installed at $HELIO_HOME (use: $0 update, or $0 uninstall)."
  mkdir -p "$HELIO_HOME"
  tag=$(resolve_tag)
  step "Downloading Helio $tag"; download_bundle "$tag"
  step "Generating this install's secrets"
  fill_env "$HELIO_HOME/.env.template" "$ENV_FILE"
  set_env COMPOSE_PROFILES "$PROFILE"
  cp "$HELIO_HOME/manifest.json" "$MANIFEST_FILE" 2>/dev/null || true
  ok "configuration written to $ENV_FILE (keep this file with your backups)"
  bring_up "$PROFILE"
  self_install
  if wait_healthy; then ok "the dashboard is answering"; else warn "the dashboard is still warming up — '$0 status' shows progress"; fi
  print_ready
  url=$(get_env APP_URL); [ -n "$url" ] || url="http://localhost:3000"
  [ "${HELIO_NO_BROWSER:-}" = "1" ] || open_browser "$url"
}

cmd_update() {
  [ -f "$MANIFEST_FILE" ] || die "no installation at $HELIO_HOME — run: $0 install"
  step "Checking Docker"; ensure_docker; ok "Docker is ready"
  current=$(manifest_version)
  tag=$(resolve_tag)
  [ "$tag" = "$current" ] && { say "already on $current — nothing to update."; return 0; }
  step "Updating $current -> $tag"
  step "Backing up the database first (the rollback path)"
  compose --profile ops run --rm backup run pre-update || die "pre-update backup failed — fix that first, or back up manually."
  ok "backup saved to $HELIO_HOME/backups"
  step "Fetching $tag"; download_bundle "$tag"
  step "Applying the update"
  compose down || true
  merge_new_env_keys "$HELIO_HOME/.env.template"
  cp "$HELIO_HOME/manifest.json" "$MANIFEST_FILE" 2>/dev/null || true
  prof=$(get_env COMPOSE_PROFILES); [ -n "$prof" ] || prof=core
  compose --profile "$prof" pull || die "image pull failed"
  compose up -d --wait postgres redis mailpit || die "datastores failed to start"
  compose --profile ops run --rm migrate deploy || die "migration failed — restore the pre-update backup (see $HELIO_HOME/backups)"
  compose --profile "$prof" up -d --wait || die "services did not become healthy (try: $0 status)"
  wait_healthy && ok "Helio $tag is up" || warn "update applied; the dashboard is still warming up"
}

cmd_uninstall() {
  [ -f "$MANIFEST_FILE" ] || die "no installation at $HELIO_HOME"
  purge=0; [ "${1:-}" = "--purge-data" ] && purge=1
  if [ "$purge" = "1" ]; then
    warn "This stops Helio and PERMANENTLY ERASES its database, volumes, and configuration."
  else
    warn "This stops Helio and removes its containers. Your data volumes are kept."
  fi
  if [ -t 0 ] && [ "${HELIO_YES:-}" != "1" ]; then
    printf 'Type "uninstall" to continue: '; read -r reply
    [ "$reply" = "uninstall" ] || { warn "aborted — nothing was changed"; exit 1; }
  fi
  if [ "$purge" = "1" ]; then
    compose --profile core --profile full --profile ops --profile update down --volumes || true
    rm -rf "$HELIO_HOME"
    say "removed $HELIO_HOME"
  else
    compose --profile core --profile full --profile update down || true
    say "stopped. Data is kept in Docker volumes; '$0 start' brings it back."
  fi
}

cmd_start()  { [ -f "$MANIFEST_FILE" ] || die "no installation — run: $0 install"; prof=$(get_env COMPOSE_PROFILES); [ -n "$prof" ] || prof=core; compose --profile "$prof" up -d --wait; }
cmd_stop()   { [ -f "$MANIFEST_FILE" ] || die "no installation at $HELIO_HOME"; compose --profile core --profile full --profile update down; }
cmd_logs()   { [ -f "$MANIFEST_FILE" ] || die "no installation at $HELIO_HOME"; compose logs --tail 200 --follow "$@"; }
cmd_status() {
  [ -f "$MANIFEST_FILE" ] || die "no installation at $HELIO_HOME — run: $0 install"
  say "Helio $(manifest_version) at $HELIO_HOME (profile: $(get_env COMPOSE_PROFILES))"
  compose ps || true
  url=$(get_env APP_URL); [ -n "$url" ] || url="http://localhost:3000"
  http_ok "$url/api/healthz" && say "dashboard answering at $url" || say "dashboard not answering at $url"
}

cmd_backup() {
  [ -f "$MANIFEST_FILE" ] || die "no installation at $HELIO_HOME"
  compose run --rm backup run manual
  say "backup written to $HELIO_HOME/backups"
}

cmd_restore() {
  [ -f "$MANIFEST_FILE" ] || die "no installation at $HELIO_HOME"
  file="${1:-}"
  [ -n "$file" ] || die "usage: $0 restore <backup-file>  (see $HELIO_HOME/backups)"
  warn "Restoring REPLACES the current database with the backup — anything newer is lost."
  if [ -t 0 ] && [ "${HELIO_YES:-}" != "1" ]; then
    printf 'Type "restore" to continue: '; read -r reply
    [ "$reply" = "restore" ] || { warn "aborted — nothing was changed"; exit 1; }
  fi
  compose run --rm backup restore "$file"
}

cmd_doctor() {
  healthy=1
  if have docker && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker is installed, running, and has Compose v2"
  else warn "Docker is not ready (install it / start the daemon)"; healthy=0; fi
  if have openssl; then ok "openssl present (secret generation)"; else warn "openssl missing"; healthy=0; fi
  if [ -f "$MANIFEST_FILE" ]; then
    say "   installed: Helio $(manifest_version) at $HELIO_HOME (profile: $(get_env COMPOSE_PROFILES))"
    url=$(get_env APP_URL); [ -n "$url" ] || url="http://localhost:3000"
    http_ok "$url/api/healthz" && ok "dashboard answering at $url" || { warn "dashboard not answering at $url ('$0 status' for detail)"; healthy=0; }
  else
    say "   not installed here — run: $0 install"
  fi
  [ "$healthy" = "1" ] && ok "all checks passed" || { warn "some checks failed (see above)"; return 1; }
}

# Offline self-check: secret kinds produce the expected shapes and the template
# fills with no markers left. Run: ./install.sh selftest
cmd_selftest() {
  have openssl || die "selftest needs openssl"
  [ "$(gen_secret HEX32 | wc -c)" -eq 65 ] || die "HEX32 wrong length"   # 64 chars + newline
  [ "$(gen_secret HEX24 | wc -c)" -eq 49 ] || die "HEX24 wrong length"
  printf '%s' "$(gen_secret PASSWORD)" | grep -qE '^[A-Za-z0-9_-]+$' || die "PASSWORD not url-safe"
  printf '%s' "$(gen_secret B64)" | grep -qE '^[A-Za-z0-9+/=]+$' || die "B64 not base64"
  tmpl=$(mktemp); out=$(mktemp)
  printf 'A=__GENERATE_HEX32_X__\nB=__GENERATE_PASSWORD_Y__\nC=__GENERATE_B64_Z__\nD=__GENERATE_VAPID_PUBLIC__\n' > "$tmpl"
  fill_env "$tmpl" "$out"
  grep -q '__GENERATE_' "$out" && die "selftest: markers left unfilled" || true
  grep -q '^D=$' "$out" || die "selftest: VAPID should be empty"
  rm -f "$tmpl" "$out"
  ok "selftest passed"
}

menu() {
  printf '\n%sHelio%s — self-hosted, one script\n' "$B" "$R"
  if [ -f "$MANIFEST_FILE" ]; then
    say "${D}installed: Helio $(manifest_version) at $HELIO_HOME${R}"
    printf '\n  %s1%s  Open the dashboard\n  %s2%s  Start\n  %s3%s  Stop\n  %s4%s  Status\n  %s5%s  Update\n  %s6%s  Uninstall\n' "$Y" "$R" "$Y" "$R" "$Y" "$R" "$Y" "$R" "$Y" "$R" "$Y" "$R"
    printf '\n  choose 1-6, or q to quit: '; read -r c
    case "$c" in
      1) url=$(get_env APP_URL); open_browser "${url:-http://localhost:3000}" ;;
      2) cmd_start ;; 3) cmd_stop ;; 4) cmd_status ;; 5) cmd_update ;; 6) cmd_uninstall ;;
      *) : ;;
    esac
  else
    printf '\nHelio is not installed here.\n  %s1%s  Install Helio\n' "$Y" "$R"
    printf '\n  press 1 to install, or q to quit: '; read -r c
    [ "$c" = "1" ] && cmd_install || true
  fi
}

# ── arg parsing ─────────────────────────────────────────────────────────────
PROFILE=core
CMD=''
while [ $# -gt 0 ]; do
  case "$1" in
    install|update|uninstall|start|stop|status|logs|backup|restore|doctor|selftest) CMD="$1"; shift ;;
    --full) PROFILE=full; shift ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --yes|-y) HELIO_YES=1; shift ;;
    --purge-data) PURGE=--purge-data; shift ;;
    *) if [ "${CMD:-}" = logs ] || [ "${CMD:-}" = restore ]; then break; else die "unknown option: $1"; fi ;;
  esac
done

case "${CMD:-}" in
  install)   cmd_install ;;
  update)    cmd_update ;;
  uninstall) cmd_uninstall "${PURGE:-}" ;;
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  status)    cmd_status ;;
  logs)      cmd_logs "$@" ;;
  backup)    cmd_backup ;;
  restore)   cmd_restore "$@" ;;
  doctor)    cmd_doctor ;;
  selftest)  cmd_selftest ;;
  '')        if [ -t 0 ]; then menu; else cmd_install; fi ;;
esac
