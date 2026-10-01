#!/bin/zsh
# Build the rail-network vector-tile archive that /map draws underneath the
# portfolio: the BTS/NTAD North American Rail Network Lines, carrying the FRA's
# STRACNET designation (the DoD Strategic Rail Corridor Network and its defense
# connector lines).
#
#   zsh scripts/setup-rail-data.sh [path-to-NTAD-download.zip|path-to.gdb]
#
# With no argument it takes the newest NTAD_North_American_Rail_Network_Lines*
# download in ~/Downloads. Source (File Geodatabase, ~48MB zipped):
#   https://geodata.bts.gov/datasets/usdot::north-american-rail-network-lines
#
# WHY A PMTILES ARCHIVE AND NOT GEOJSON: the network is 302,771 line features
# and 63MB of raw geometry. A GeoJSON layer is downloaded whole by every
# browser on every page load and simplified by nobody; vector tiles send only
# the lines in view, at the detail that zoom deserves, over the same offline
# byte-range reader the basemap already uses (src/lib/map/pmtiles.ts). It is
# also the only one of the portal's formats that scales to "highlight the
# corridor this project runs on" later — every feature keeps its FRAARCID.
#
# Output: ~/berwilson-data/maps/rail.pmtiles — OUTSIDE the app dir, like the
# basemap archives, so a deploy never deletes it. Re-running rebuilds it
# (the file is replaced atomically; the tile route reopens it on the next
# request, no restart).
#
# RUN IT WITH THE CHAT MODEL UNLOADED (`lms unload --all`): tippecanoe wants
# the whole box for a few minutes and this machine swaps with 22GB of weights
# resident — §12.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAPS_DIR="$HOME/berwilson-data/maps"
OUT="$MAPS_DIR/rail.pmtiles"
LAYER_NAME="rail"
# Matches MAX_ZOOM in src/app/api/map/rail/[z]/[x]/[y]/route.ts and the
# source's maxzoom in src/lib/map/style.ts. NARN is captured at ~1:100,000, so
# there is no more detail to tile above this — MapLibre overzooms instead.
MAX_ZOOM=12

echo "==> Checking tools"
for tool in ogr2ogr ogrinfo tippecanoe pmtiles; do
  if ! command -v "$tool" >/dev/null; then
    echo "  $tool not found — brew install gdal tippecanoe pmtiles" >&2
    exit 1
  fi
done
export PATH="$HOME/.node/bin:$PATH"
command -v node >/dev/null || { echo "  node not found (need ~/.node/bin on PATH)" >&2; exit 1; }

SRC="${1:-}"
if [[ -z "$SRC" ]]; then
  SRC="$(/bin/ls -t "$HOME"/Downloads/NTAD_North_American_Rail_Network_Lines*.zip 2>/dev/null | head -1 || true)"
  [[ -n "$SRC" ]] || { echo "  No source given and none found in ~/Downloads" >&2; exit 1; }
  echo "==> Source (newest in ~/Downloads): $SRC"
else
  echo "==> Source: $SRC"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ "$SRC" == *.zip ]]; then
  echo "==> Unzipping"
  unzip -q "$SRC" -d "$TMP/src"
  GDB="$(find "$TMP/src" -maxdepth 2 -name '*.gdb' -type d | head -1)"
  [[ -n "$GDB" ]] || { echo "  No .gdb inside the zip" >&2; exit 1; }
else
  GDB="$SRC"
fi
[[ -d "$GDB" ]] || { echo "  Not a File Geodatabase: $GDB" >&2; exit 1; }

# The layer name is the portal's, not ours — read it rather than hard-code it,
# so a re-publish under a new name fails loudly here instead of silently
# tiling nothing.
LAYER="$(ogrinfo -q "$GDB" | sed -n '1s/^Layer: \(.*\) (.*/\1/p')"
[[ -n "$LAYER" ]] || { echo "  Could not read a layer name out of $GDB" >&2; exit 1; }
echo "==> Layer: $LAYER"

GEOJSON="$TMP/rail.geojsonl"
echo "==> Extracting attributes + geometry (WGS84, 6dp)"
# 6 decimal places is ~0.1m — far finer than a 1:100,000 rail centreline, and
# it roughly halves the intermediate file against ogr2ogr's default 15.
ogr2ogr -f GeoJSONSeq /vsistdout/ "$GDB" "$LAYER" \
  -t_srs EPSG:4326 \
  -lco COORDINATE_PRECISION=6 \
  -select FRAARCID,RROWNER1,TRKRGHTS1,SUBDIV,BRANCH,STRACNET,NET,PASSNGR,TRACKS,MILES,STATEAB \
  | node "$REPO_ROOT/scripts/rail-tile-hints.mjs" > "$GEOJSON"

echo "==> Tiling (zoom 0-$MAX_ZOOM)"
# --simplification only at low zoom: at z12 a rail centreline is already the
# shape of the track and smoothing it moves the line off the right-of-way.
#
# WHAT IS MISSING AT A GIVEN ZOOM IS A DECISION, NOT A CASUALTY: rail-tile-
# hints.mjs sets a per-feature minzoom, so it is the KIND of track that decides
# (STRACNET everywhere, yard leads only up close) rather than
# --drop-densest-as-needed, which is blind to what a line is and would thin a
# strategic corridor through a busy terminal district while keeping the yard
# tracks beside it. --drop-smallest-as-needed is only the backstop for a tile
# still over the byte cap after that, and it sheds the SHORTEST segments first
# — a long corridor survives losing a stub.
tippecanoe \
  -o "$TMP/rail.mbtiles" \
  -l "$LAYER_NAME" \
  -n "North American Rail Network" \
  -A "BTS/NTAD North American Rail Network Lines (FRA)" \
  --minimum-zoom=0 \
  --maximum-zoom=$MAX_ZOOM \
  --simplification=4 \
  --simplify-only-low-zooms \
  --maximum-tile-bytes=1000000 \
  --drop-smallest-as-needed \
  --hilbert \
  --no-tile-stats \
  --force \
  "$GEOJSON"

echo "==> Converting to PMTiles"
mkdir -p "$MAPS_DIR"
pmtiles convert "$TMP/rail.mbtiles" "$TMP/rail.pmtiles"
# Move into place last: a half-written archive at $OUT would be served, and
# the tile route reads it by byte range without ever noticing it is truncated.
mv -f "$TMP/rail.pmtiles" "$OUT"

echo "==> Done: $OUT ($(du -h "$OUT" | cut -f1))"
pmtiles show "$OUT" | head -12
echo
echo "   The map picks it up on the next tile request — no restart needed."
echo "   Turn it on from the rail control in the /map toolbar."
