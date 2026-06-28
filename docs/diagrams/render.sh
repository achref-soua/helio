#!/usr/bin/env bash
# Render every docs/diagrams/*.mmd to docs/assets/diagrams/*.svg via mermaid-cli.
#
#   Local : point at any Chromium (e.g. Playwright's) —
#           PUPPETEER_EXECUTABLE_PATH=/path/to/chrome bash docs/diagrams/render.sh
#   CI    : `npx puppeteer browsers install chrome` first, then leave it unset.
#
# Kept dependency-free: mermaid-cli is fetched on demand via npx (pinned).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/../assets/diagrams"
mkdir -p "$out"
shopt -s nullglob
n=0
for mmd in "$here"/*.mmd; do
  name="$(basename "$mmd" .mmd)"
  echo "render → $name.svg"
  npx --yes @mermaid-js/mermaid-cli@11 \
    -i "$mmd" -o "$out/$name.svg" \
    -c "$here/mermaid-config.json" \
    -p "$here/puppeteer-config.json" \
    -b transparent
  n=$((n + 1))
done
echo "rendered $n diagram(s) → docs/assets/diagrams/"
