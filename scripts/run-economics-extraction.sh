#!/bin/zsh
# Unattended wrapper for the economics extraction.
#
# The pass is ~9 hours over 629 documents and is meant to run with nobody
# watching, so it needs three things the bare script does not give it:
#
#   1. SURVIVE THE TERMINAL CLOSING — launched under nohup, stdin from
#      /dev/null, so SIGHUP does not take it with the session that started it.
#   2. RESUME RATHER THAN RESTART — `--extract-only` now skips any record whose
#      model already has staged proposals, so each attempt continues where the
#      last stopped instead of duplicating finished work.
#   3. SURVIVE ONE BAD NIGHT — a deploy, an OOM kill or a dropped LM Studio
#      request ends the node process. Up to MAX_ATTEMPTS retries, each one
#      resuming, with a pause between so a hard failure does not spin.
#
# ⚠ It deliberately does NOT unload or reload any model: extraction IS the chat
# model's work, and LM Studio serves one request at a time, so this interleaves
# with Pepper's crons rather than racing them. Everything just runs slower
# while it is going.
#
#   nohup zsh scripts/run-economics-extraction.sh >/dev/null 2>&1 &
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.node/bin:$PATH"

LOG_DIR="$HOME/Library/Logs/berwilson"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/economics-extraction.log"
MAX_ATTEMPTS=5

print "=== economics extraction started $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"

attempt=1
while (( attempt <= MAX_ATTEMPTS )); do
  print "--- attempt $attempt of $MAX_ATTEMPTS at $(date '+%H:%M:%S') ---" >> "$LOG"
  node --experimental-strip-types --import ./deploy/register.mjs --env-file=.env.local \
       scripts/seed-economics-models.mts --apply --extract-only >> "$LOG" 2>&1
  rc=$?
  if (( rc == 0 )); then
    print "=== finished cleanly $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"
    exit 0
  fi
  print "!!! attempt $attempt exited $rc — resuming in 60s" >> "$LOG"
  attempt=$(( attempt + 1 ))
  sleep 60
done

print "=== gave up after $MAX_ATTEMPTS attempts $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"
exit 1
