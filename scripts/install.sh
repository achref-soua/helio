#!/bin/sh
# Helio one-line installer (Linux / macOS):
#   curl -fsSL https://github.com/achref-soua/helio/releases/latest/download/install.sh | sh
#
# Downloads the right `helio` binary for this machine into ~/.helio/bin,
# then runs `helio install` — which checks Docker, generates secrets, and
# brings the stack up. Re-running is safe: an existing installation is
# left alone and you are pointed at `helio update`.
set -eu

REPO="achref-soua/helio"
BIN_DIR="${HELIO_HOME:-$HOME/.helio}/bin"

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Linux) platform="linux" ;;
  Darwin) platform="darwin" ;;
  *) echo "unsupported OS: $os (Windows: use install.ps1)" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64 | amd64) cpu="x64" ;;
  arm64 | aarch64) cpu="arm64" ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="helio-${platform}-${cpu}"
url="https://github.com/${REPO}/releases/latest/download/${asset}"
if [ "${HELIO_VERSION:-}" != "" ]; then
  url="https://github.com/${REPO}/releases/download/${HELIO_VERSION}/${asset}"
fi

echo "downloading ${asset}…"
mkdir -p "$BIN_DIR"
curl -fSL --progress-bar -o "$BIN_DIR/helio" "$url"
chmod +x "$BIN_DIR/helio"

echo ""
echo "helio installed to $BIN_DIR/helio"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "add it to your PATH:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
echo ""

exec "$BIN_DIR/helio" install ${HELIO_VERSION:+--version "$HELIO_VERSION"}
