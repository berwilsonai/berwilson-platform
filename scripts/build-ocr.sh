#!/bin/zsh
# Build the local OCR binary used by the business-card scanner.
#
# Requires the macOS Command Line Tools (`xcode-select --install`) — nothing
# else. Vision ships with the OS, so there is no model to download.
#
# Run once per machine, and again if scripts/ocr/card-ocr.swift changes:
#   zsh scripts/build-ocr.sh
#
# Installs to ~/.local/bin/bw-ocr — deliberately OUTSIDE the app directory, so
# it survives a deploy that rsyncs the working tree with --delete (same reason
# whisper-cli and the map archives live outside).
set -e
here="${0:A:h}"
out="$HOME/.local/bin"
mkdir -p "$out"
swiftc -O -o "$out/bw-ocr" "$here/ocr/card-ocr.swift"
echo "built $out/bw-ocr"
"$out/bw-ocr" 2>&1 | head -1 || true
