#!/usr/bin/env zsh
# Build bw-snapshot, the only thing on this box that holds Full Disk Access.
# Mirrors scripts/build-ocr.sh.
set -euo pipefail

src="${0:A:h}/local-sources/snapshot.swift"
out="$HOME/.local/bin/bw-snapshot"

# The signing identity that makes the Full Disk Access grant SURVIVE a rebuild.
#
# ⚠ WHY THIS EXISTS, MEASURED 2026-10-12. TCC keys a grant to the binary's
# identity. For an ad-hoc ("linker-signed") binary that identity is its code
# HASH, so every rebuild is a different program as far as TCC is concerned and
# the grant silently stops applying. It happened for real within the hour:
# Richard granted access, another session edited snapshot.swift at 09:12:44 and
# rebuilt one second later, and the next launchd run was denied again — while a
# hand test from a terminal kept passing, because the terminal holds its own
# grant.
#
# A binary signed with a STABLE certificate has a stable designated
# requirement (identifier + that certificate), so the grant survives every
# rebuild. Any self-signed code-signing certificate does — no Apple Developer
# account, no fee. Create one ONCE:
#
#   Keychain Access → Certificate Assistant → Create a Certificate…
#     Name: Ber Wilson Local
#     Identity Type: Self Signed Root
#     Certificate Type: Code Signing
#
# Then re-grant Full Disk Access one final time. After that this script signs
# every build with it and the grant holds.
SIGN_ID="${BW_SIGN_IDENTITY:-Ber Wilson Local}"

mkdir -p "$(dirname "$out")"
echo "Building $src → $out"
xcrun swiftc -O -o "$out" "$src"
chmod 755 "$out"

# `--identifier` is pinned so the designated requirement does not depend on the
# file name, and `-f` replaces the ad-hoc signature swiftc already applied.
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$SIGN_ID"; then
  codesign -f -s "$SIGN_ID" --identifier com.berwilson.snapshot "$out"
  echo "✓ signed with '$SIGN_ID' — the Full Disk Access grant survives rebuilds"
  signed=1
else
  echo "⚠ NOT SIGNED: no code-signing identity called '$SIGN_ID' in the keychain."
  echo "  The binary is ad-hoc signed, so TCC keys the grant to its code hash and"
  echo "  THIS BUILD JUST INVALIDATED ANY EXISTING GRANT. See the note above to"
  echo "  create a self-signed certificate once and end that for good."
  signed=0
fi

echo
if [[ $signed -eq 1 ]]; then
  echo "Built and signed. If this is the FIRST signed build, re-grant once:"
else
  echo "Built. Grant it Full Disk Access AGAIN (this build voided the last grant):"
fi
echo "  System Settings → Privacy & Security → Full Disk Access → + → $out"
echo
echo "⚠ Remove the stale entry first if one is listed — a dead entry looks"
echo "  identical to a live one, and the failure is silent until the next"
echo "  SCHEDULED run: the terminal you test from has its own grant, so a hand"
echo "  run succeeds while launchd's keeps being denied. Test it properly with"
echo "    launchctl kickstart -k gui/\$(id -u)/com.berwilson.snapshot"
echo "  then read ~/Library/Logs/berwilson/snapshot.err.log"
echo
echo "⚠ Finder hides ~/.local by default — press Cmd-Shift-G in the file picker"
echo "  and paste the path above."
echo
echo "Then verify:  $out && ls -la ~/berwilson-data/local-sources/"
