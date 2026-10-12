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
# the grant silently stops applying. It cost Richard THREE grants in one
# morning: he granted at ~08:50, a session rebuilt at 09:12 because the source
# had genuinely changed, he granted again, and a second session then ran this
# script at 09:32 to read its own output and voided that one too — having
# changed nothing. A hand test kept passing throughout, because a terminal
# holds its own grant; only the launchd run was denied.
#
# A binary signed with a stable certificate has a designated requirement of
#   identifier "com.berwilson.snapshot" and certificate root = H"<cert>"
# with NO code hash in it, so the grant survives every rebuild. The certificate
# is self-signed, local and code-signing-only.
#
# Config lives in .env.local (BW_SIGN_KEYCHAIN / _PASSWORD / BW_SIGN_IDENTITY)
# because THE REPO IS PUBLIC. Its own keychain, not the login one, so signing
# never needs Richard's login password and never raises a dialog.
if [[ -f "${0:A:h:h}/.env.local" ]]; then
  SIGN_KC="$(grep '^BW_SIGN_KEYCHAIN=' "${0:A:h:h}/.env.local" | cut -d= -f2- || true)"
  SIGN_PW="$(grep '^BW_SIGN_KEYCHAIN_PASSWORD=' "${0:A:h:h}/.env.local" | cut -d= -f2- || true)"
  SIGN_ID="$(grep '^BW_SIGN_IDENTITY=' "${0:A:h:h}/.env.local" | cut -d= -f2- || true)"
fi
SIGN_ID="${SIGN_ID:-Ber Wilson Local}"

mkdir -p "$(dirname "$out")"

# ⚠ A NO-OP REBUILD IS NOT FREE — IT COSTS THE FULL DISK ACCESS GRANT.
#
# TCC keys an ad-hoc binary to its code HASH, so replacing the file with an
# identical-behaving build still voids the grant. That is not theoretical: on
# 2026-10-12 Richard granted access at ~08:50, a session rebuilt at 09:12
# because the source had genuinely changed, he granted again, and then a second
# session ran this script to check its own output at 09:32 and voided THAT
# grant too — having changed nothing at all.
#
# So the build is skipped when the source has not moved since the binary was
# made. A real source change still rebuilds and still says to re-grant; a
# routine "run it to be safe" now costs nothing. `--force` overrides.
stamp="$out.built-from"
hash_now="$(shasum -a 256 "$src" | cut -d' ' -f1)"
force=0
[[ "${1:-}" == "--force" ]] && force=1

if [[ $force -eq 0 && -x "$out" && -f "$stamp" && "$(cat "$stamp")" == "$hash_now" ]]; then
  echo "✓ $out is already built from this exact source — nothing to do."
  echo "  Skipped deliberately: rebuilding would void the Full Disk Access grant"
  echo "  for no gain. Use --force if you really want to replace the binary."
  exit 0
fi

echo "Building $src → $out"
xcrun swiftc -O -o "$out" "$src"
chmod 755 "$out"
printf '%s' "$hash_now" > "$stamp"

# `--identifier` is pinned so the designated requirement does not depend on the
# file name, and `-f` replaces the ad-hoc signature swiftc already applied.
signed=0
if [[ -n "${SIGN_KC:-}" && -f "$SIGN_KC" ]]; then
  # Unlocking is harmless if it is already unlocked, and is what stops a build
  # after a reboot from raising the dialog this whole arrangement avoids.
  security unlock-keychain -p "$SIGN_PW" "$SIGN_KC" >/dev/null 2>&1 || true
  if codesign -f --keychain "$SIGN_KC" -s "$SIGN_ID" \
       --identifier com.berwilson.snapshot "$out" 2>/dev/null; then
    echo "✓ signed with '$SIGN_ID' — the Full Disk Access grant survives rebuilds"
    signed=1
  fi
fi
if [[ $signed -eq 0 ]]; then
  echo "⚠ NOT SIGNED: no usable identity '$SIGN_ID' (BW_SIGN_KEYCHAIN in .env.local)."
  echo "  The binary is ad-hoc signed, so TCC keys the grant to its code hash and"
  echo "  THIS BUILD JUST INVALIDATED ANY EXISTING GRANT."
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
