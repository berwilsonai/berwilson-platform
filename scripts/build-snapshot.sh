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
echo "Built. Now grant it Full Disk Access:"
echo "  System Settings → Privacy & Security → Full Disk Access → + → $out"
echo
echo "⚠ NOT 'once' — TCC keys the grant to THIS binary, and this script just"
echo "  replaced it. Re-granting after every rebuild is the cost of the design"
echo "  (an unsigned binary at a fixed path), and the failure is silent until"
echo "  the next scheduled run: the terminal you test from has its own grant,"
echo "  so a hand run succeeds while launchd's keeps being denied."
echo
echo "⚠ Finder hides ~/.local by default — press Cmd-Shift-G in the file picker"
echo "  and paste the path above."
echo
echo "Then verify:  $out && ls -la ~/berwilson-data/local-sources/"
