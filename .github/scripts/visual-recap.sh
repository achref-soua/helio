#!/usr/bin/env bash
# Build the per-release visual recap: a montage image + a gallery markdown.
# Screenshots are committed at the tag (raw URLs render in release notes);
# the montage is uploaded as a release asset, so it is referenced by its
# release-download URL.
#
# Usage: visual-recap.sh <tag>
# Requires: ImageMagick `montage`, env GITHUB_REPOSITORY.
set -euo pipefail
tag="${1:?usage: visual-recap.sh <tag>}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
raw="https://raw.githubusercontent.com/$repo/$tag"
blob="https://github.com/$repo/blob/$tag"
dl="https://github.com/$repo/releases/download/$tag"

out="out/recap"
mkdir -p "$out"

# Hero montage from product screenshots. PNGs render in release notes; SVGs do not,
# so the diagram gallery is linked rather than embedded.
shots=(dashboard journey-canvas segment-builder email-builder campaigns contacts)
files=()
for s in "${shots[@]}"; do
  [ -f "docs/assets/$s.png" ] && files+=("docs/assets/$s.png")
done
montage "${files[@]}" \
  -tile 2x3 -geometry 640x+10+10 -background white \
  -title "Helio $tag — visual recap" \
  "$out/helio-visual-recap.png"

# Gallery markdown — uploaded as an asset and appended to the release notes.
md="$out/visual-recap.md"
{
  echo "<!-- visual-recap -->"
  echo "### Visual recap"
  echo
  echo "[![Helio $tag]($dl/helio-visual-recap.png)]($blob/docs/diagrams.md)"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| ![Dashboard]($raw/docs/assets/dashboard.png) | ![Journey canvas]($raw/docs/assets/journey-canvas.png) |"
  echo "| ![Segment builder]($raw/docs/assets/segment-builder.png) | ![Email builder]($raw/docs/assets/email-builder.png) |"
  echo "| ![Campaigns]($raw/docs/assets/campaigns.png) | ![Contacts]($raw/docs/assets/contacts.png) |"
  echo
  echo "**More:** [subsystem diagrams]($blob/docs/diagrams.md) · [architecture]($blob/docs/architecture.md) · [product guide PDF]($raw/docs/helio-product-guide.pdf) · [setup guide PDF]($raw/docs/helio-setup-guide.pdf)"
} >"$md"

echo "wrote $out/helio-visual-recap.png and $md"
