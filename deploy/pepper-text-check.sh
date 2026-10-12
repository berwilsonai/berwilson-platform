#!/bin/zsh
# Assert the text channel can work, without texting anybody.
#
# A health check that sends a real message is a health check nobody runs, so
# this only verifies the parts that break silently: the binary, the shortcut
# names, and the handles.
set -u
cd "$(dirname "$0")/.." || exit 1

fail=0
note() { print -r -- "$1" }

SHORTCUTS_BIN=${SHORTCUTS_BIN:-/usr/bin/shortcuts}
if [[ ! -x $SHORTCUTS_BIN ]]; then
  note "FAIL  $SHORTCUTS_BIN is missing or not executable"
  exit 1
fi
note "ok    $SHORTCUTS_BIN"

# ⚠ Read the env the same way the app does, and do not leak it.
if [[ -f .env.local ]]; then
  targets=$(grep -E '^PEPPER_TEXT_TARGETS=' .env.local | head -1 | cut -d= -f2-)
else
  targets=${PEPPER_TEXT_TARGETS:-}
fi

if [[ -z ${targets:-} ]]; then
  note "FAIL  PEPPER_TEXT_TARGETS is not set — nothing can be texted."
  note "      See deploy/pepper-text-setup.md"
  exit 1
fi

# ⚠ CAPTURE, THEN MATCH. §12: `shortcuts list | grep -q` under pipefail reports
# FALSE for whatever is near the top of the output, because grep -q exits on the
# first match and SIGPIPEs the producer — that trap called two running launchd
# agents "failed to load" on every run of install-agents.sh.
installed=$($SHORTCUTS_BIN list 2>/dev/null)

print -r -- "$targets" | tr ';' '\n' | while IFS= read -r entry; do
  [[ -z ${entry// /} ]] && continue
  email=${entry%%=*}
  rest=${entry#*=}
  handle=${rest%%=*}
  shortcut=${rest#*=}
  if [[ -z $email || -z $handle || -z $shortcut || $email != *@* ]]; then
    note "FAIL  malformed target: $entry"
    fail=1
    continue
  fi
  digits=${handle//[^0-9]/}
  if (( ${#digits} < 10 )); then
    note "FAIL  $email: handle '$handle' is not a usable number"
    fail=1
  fi
  if print -r -- "$installed" | grep -Fqx -- "$shortcut"; then
    note "ok    $email -> $handle via \"$shortcut\""
  else
    note "FAIL  $email: no shortcut named \"$shortcut\" (see: $SHORTCUTS_BIN list)"
    fail=1
  fi
done

# ⚠ The while loop above runs in a subshell, so `fail` cannot escape it. Re-derive
# from the output rather than trusting a variable that cannot have been set.
if print -r -- "$targets" | tr ';' '\n' | while IFS= read -r entry; do
     [[ -z ${entry// /} ]] && continue
     shortcut=${entry##*=}
     print -r -- "$installed" | grep -Fqx -- "$shortcut" || print missing
   done | grep -q missing; then
  note ""
  note "At least one shortcut is missing. Build it: deploy/pepper-text-setup.md"
  exit 1
fi

note ""
note "Text channel looks sound. Nothing was sent."
