#!/bin/zsh
# One-time setup of the fully-offline basemap for /map.
# Run from the repo root on the MacBook:  zsh scripts/setup-map-data.sh
#
# 1. Extracts a full-depth CONUS cut of the daily Protomaps planet build to
#    ~/berwilson-data/maps/us.pmtiles (~15-25GB; the extract streams via HTTP
#    range requests — it does NOT download the 120GB planet file).
# 2. Vendors the Protomaps fonts + sprites into public/basemaps/ (gitignored;
#    the deploy rsync ships the working tree, so they reach the Studio).
#
# deploy/deploy-to-studio.sh syncs ~/berwilson-data/maps/ to the Studio.
# Re-running is safe: existing files are kept unless FORCE=1.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAPS_DIR="$HOME/berwilson-data/maps"
PMTILES="$MAPS_DIR/us.pmtiles"
ASSETS_DIR="$REPO_ROOT/public/basemaps"
# Continental US (Alaska/Hawaii: separate extracts later if projects appear there)
BBOX="-125.5,24.0,-66.5,49.6"

echo "==> Checking pmtiles CLI"
if ! command -v pmtiles >/dev/null; then
  echo "  pmtiles not found — installing via Homebrew"
  brew install pmtiles
fi
pmtiles version | head -1 || true

echo "==> Basemap archive"
mkdir -p "$MAPS_DIR"
if [[ -s "$PMTILES" && "${FORCE:-0}" != "1" ]]; then
  echo "  $PMTILES already exists ($(du -h "$PMTILES" | cut -f1)) — skipping (FORCE=1 to redo)"
else
  BUILD="$(date -v-1d +%Y%m%d)"  # yesterday's build is always complete
  echo "  Extracting CONUS from build $BUILD — this downloads 15-25GB, expect hours"
  pmtiles extract "https://build.protomaps.com/${BUILD}.pmtiles" "$PMTILES" --bbox="$BBOX"
fi
pmtiles show "$PMTILES" | head -12

echo "==> Style assets (fonts + sprites) -> public/basemaps/"
if [[ -d "$ASSETS_DIR/fonts" && -d "$ASSETS_DIR/sprites" && "${FORCE:-0}" != "1" ]]; then
  echo "  already vendored — skipping (FORCE=1 to redo)"
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  git clone --depth 1 https://github.com/protomaps/basemaps-assets "$TMP/basemaps-assets"
  mkdir -p "$ASSETS_DIR"
  rm -rf "$ASSETS_DIR/fonts" "$ASSETS_DIR/sprites"
  # Full font set is ~40MB; the style only asks for what it needs at runtime.
  cp -R "$TMP/basemaps-assets/fonts" "$ASSETS_DIR/fonts"
  cp -R "$TMP/basemaps-assets/sprites" "$ASSETS_DIR/sprites"
fi
ls "$ASSETS_DIR/fonts" | head -5
ls "$ASSETS_DIR/sprites"

echo "==> Done. Deploy with: zsh deploy/deploy-to-studio.sh (first run pushes the tiles once)"
