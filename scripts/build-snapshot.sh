#!/usr/bin/env zsh
# Build bw-snapshot, the only thing on this box that holds Full Disk Access.
# Mirrors scripts/build-ocr.sh.
set -euo pipefail

src="${0:A:h}/local-sources/snapshot.swift"
out="$HOME/.local/bin/bw-snapshot"

mkdir -p "$(dirname "$out")"
echo "Building $src → $out"
xcrun swiftc -O -o "$out" "$src"
chmod 755 "$out"

echo
echo "Built. Now grant it Full Disk Access ONCE:"
echo "  System Settings → Privacy & Security → Full Disk Access → + → $out"
echo
echo "⚠ Finder hides ~/.local by default — press Cmd-Shift-G in the file picker"
echo "  and paste the path above."
echo
echo "Then verify:  $out && ls -la ~/berwilson-data/local-sources/"
