#!/usr/bin/env zsh
# Install every launchd agent in deploy/ onto THIS machine.
#
# The Studio is the repo and production both (CLAUDE.md), so agents are
# installed locally — there is nothing to ssh to. `deploy-to-studio.sh` still
# carries a copy of this loop for the retired MacBook→Studio flow; this is the
# one that runs now.
#
# ⚠ THE LIST IS DERIVED FROM THE FILESYSTEM, NEVER ENUMERATED.
#
# deploy-to-studio.sh names its agents in a hand-written list, and by
# 2026-10-11 that list had fallen two behind the directory: com.berwilson.
# cron-meeting-prep and com.berwilson.cron-commitment-chase both existed as
# files and were installed by nothing at all. A plist that is never installed
# is a feature that silently never runs, and the deploy reports success either
# way. Same lesson as every other hand-incremented count in this repo — derive
# it, so adding a plist is adding a file.
#
#   zsh deploy/install-agents.sh            # install/reload everything
#   zsh deploy/install-agents.sh --list     # show what would be installed
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/berwilson"
AGENT_DIR="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"

# ⚠ NEVER `launchctl list | grep -q` UNDER `set -o pipefail`.
#
# `grep -q` exits the moment it matches, which SIGPIPEs `launchctl list`, which
# makes the PIPELINE non-zero — so the test reports "not loaded" for precisely
# the labels near the TOP of launchctl's output, where grep quits soonest, and
# reports correctly for the ones near the bottom. Measured 2026-10-11: this
# called com.berwilson.cron-risk-scores and com.berwilson.cron-drive-publish
# FAILED TO LOAD on every run while both were running perfectly, and they are
# the first two lines launchctl prints.
#
# deploy/deploy-to-studio.sh carries the same pattern in its own copy of this
# loop and has the same bug.
is_loaded() {
  local listing
  listing="$(launchctl list 2>/dev/null || true)"
  [[ "$listing" == *"$1"* ]]
}

plists=("$REPO_ROOT"/deploy/com.berwilson.*.plist)
if (( ${#plists[@]} == 0 )); then
  echo "No plists found in $REPO_ROOT/deploy" >&2
  exit 1
fi

if [[ "${1:-}" == "--list" ]]; then
  echo "${#plists[@]} agent(s) in deploy/:"
  for p in "${plists[@]}"; do echo "  ${${p:t}:r}"; done
  exit 0
fi

mkdir -p "$LOG_DIR" "$AGENT_DIR"
echo "==> Installing ${#plists[@]} launchd agent(s)"

failed=0
for p in "${plists[@]}"; do
  label="${${p:t}:r}"

  sed -e "s#__APP_DIR__#$HOME/berwilson-platform#g" \
      -e "s#__LOG_DIR__#$LOG_DIR#g" \
      -e "s#__NODE_BIN__#$HOME/.node/bin#g" \
      -e "s#__HOME__#$HOME#g" \
      "$p" > "$AGENT_DIR/$label.plist"

  launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
  # bootout is ASYNC. A fixed sleep raced it and left com.berwilson.platform
  # unloaded entirely (2026-08-23), so poll until it is really gone.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    is_loaded "$label" || break
    sleep 1
  done

  launchctl bootstrap "gui/$UID_NUM" "$AGENT_DIR/$label.plist" 2>/dev/null \
    || launchctl kickstart "gui/$UID_NUM/$label" 2>/dev/null \
    || { sleep 3; launchctl bootstrap "gui/$UID_NUM" "$AGENT_DIR/$label.plist" 2>/dev/null; }

  # Confirm it came back rather than assuming it did — and POLL for it, because
  # bootstrap returning is not the same as the service being listed. Checking
  # immediately reported com.berwilson.cron-risk-scores and -drive-publish as
  # FAILED TO LOAD while both were in fact running, which is the same
  # untrustworthy signal as a pass claiming work it did not do, pointed the
  # other way: a deploy that cries wolf gets read as noise.
  loaded=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if is_loaded "$label"; then loaded=1; break; fi
    sleep 1
  done
  if (( loaded )); then
    echo "    $label: loaded"
  else
    echo "    $label: FAILED TO LOAD"
    failed=$((failed + 1))
  fi
done

if (( failed > 0 )); then
  echo "==> $failed agent(s) FAILED to load" >&2
  exit 1
fi
echo "==> all ${#plists[@]} agents loaded"
