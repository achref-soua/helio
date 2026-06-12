#!/usr/bin/env bash
# Cross-compile the helio CLI into single-file binaries for every
# supported platform. Bun targets them all from one machine.
#
#   bash scripts/release/build-binaries.sh v2.0.0
#
# Output: dist/helio-{linux,darwin}-{x64,arm64}, dist/helio-windows-x64.exe
# plus sha256 lines appended to dist/checksums.txt.
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION="${1:?usage: build-binaries.sh vX.Y.Z}"
command -v bun >/dev/null || {
  echo "bun is required (curl -fsSL https://bun.sh/install | bash)" >&2
  exit 1
}

mkdir -p dist
ENTRY=apps/cli/src/main.ts

build() {
  target="$1"
  output="$2"
  echo "building $output ($target)…"
  bun build --compile --minify \
    --target="$target" \
    --define "process.env.HELIO_CLI_VERSION=\"$VERSION\"" \
    "$ENTRY" --outfile "dist/$output"
}

build bun-linux-x64 helio-linux-x64
build bun-linux-arm64 helio-linux-arm64
build bun-darwin-x64 helio-darwin-x64
build bun-darwin-arm64 helio-darwin-arm64
build bun-windows-x64 helio-windows-x64.exe

(
  cd dist
  for file in helio-linux-x64 helio-linux-arm64 helio-darwin-x64 helio-darwin-arm64 helio-windows-x64.exe; do
    sha256sum "$file" >>checksums.txt
  done
)
echo "binaries in dist/ — checksums appended to dist/checksums.txt"
