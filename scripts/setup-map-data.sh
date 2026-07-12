#!/bin/zsh
# One-time setup of the fully-offline basemap for /map.
# Run from the repo root on the MacBook:  zsh scripts/setup-map-data.sh
#
# 1. Extracts a cut of the daily Protomaps planet build to
#    ~/berwilson-data/maps/us.pmtiles (the extract streams via HTTP range
#    requests — it does NOT download the 120GB planet file).
#      SCOPE=dev     (default) ~400MB Utah + Tonga + Albania — local dev
#      SCOPE=regions ~17-20GB full-depth CONUS + Tonga + Albania — production;
#                    run ON THE STUDIO (it has the disk), see deploy/README.md
#      SCOPE=utah|conus  legacy single-bbox cuts (US only)
#    Coverage boxes live in scripts/map-regions-{full,dev}.geojson — add a box
#    there when the portfolio reaches a new country, then re-extract.
# 2. Vendors the Protomaps fonts + sprites into public/basemaps/ (gitignored;
#    the deploy rsync ships the working tree, so they reach the Studio).
#
# The deploy script pushes the archive to the Studio ONCE if it has none, and
# never overwrites an existing Studio archive (which is usually the bigger
# CONUS extract). Re-running is safe: existing files are kept unless FORCE=1.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAPS_DIR="$HOME/berwilson-data/maps"
PMTILES="$MAPS_DIR/us.pmtiles"
ASSETS_DIR="$REPO_ROOT/public/basemaps"
# Region scopes cover the international portfolio (Tonga, Albania) alongside
# the US; legacy bbox scopes kept for US-only cuts. (Alaska/Hawaii: add boxes
# to the region files if projects appear there.)
BBOX="" REGION=""
case "${SCOPE:-dev}" in
  regions) REGION="$REPO_ROOT/scripts/map-regions-full.geojson" ;;
  dev)     REGION="$REPO_ROOT/scripts/map-regions-dev.geojson" ;;
  conus)   BBOX="-125.5,24.0,-66.5,49.6" ;;
  utah)    BBOX="-114.05,36.99,-109.04,42.00" ;;
  *) echo "unknown SCOPE '$SCOPE' (dev|regions|utah|conus)"; exit 1 ;;
esac

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
  echo "  Extracting ${SCOPE:-dev} from build $BUILD (regions/conus = 17-20GB, expect ~1h)"
  if [[ -n "$REGION" ]]; then
    pmtiles extract "https://build.protomaps.com/${BUILD}.pmtiles" "$PMTILES" --region="$REGION"
  else
    pmtiles extract "https://build.protomaps.com/${BUILD}.pmtiles" "$PMTILES" --bbox="$BBOX"
  fi
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
