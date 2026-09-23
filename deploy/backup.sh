#!/bin/zsh
# ─────────────────────────────────────────────────────────────────────────────
# REFERENCE COPY. The live script runs from ~/supabase-selfhost/backup.sh,
# driven by the com.berwilson.backup launchd agent at 2:30am.
#
# It is committed here because it was not committed anywhere, which made the
# disaster-recovery script itself a single unbacked-up file on the one machine
# it protects — the same shape as the 2026-08-25 loss of ~/berwilson-data.
#
# The two copies are NOT auto-synced (the current deploy path is git + build +
# kickstart; deploy-to-studio.sh is retired). After editing either, copy it
# across and re-run it once by hand:
#     cp deploy/backup.sh ~/supabase-selfhost/backup.sh
#     zsh ~/supabase-selfhost/backup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e
export PATH=$HOME/.local/bin:$PATH
STAMP=$(date +%Y%m%d-%H%M)
DEST=$HOME/Backups/berwilson
mkdir -p "$DEST"
docker exec supabase-db pg_dumpall -U postgres | gzip > "$DEST/db-$STAMP.sql.gz"
tar -czf "$DEST/storage-$STAMP.tgz" -C $HOME/supabase-selfhost/docker/volumes storage 2>/dev/null || true
# retention: keep 14 days
find "$DEST" -name "*.gz" -o -name "*.tgz" | while read f; do
  [ $(( ($(date +%s) - $(stat -f %m "$f")) / 86400 )) -gt 14 ] && rm "$f" || true
done
echo "$(date): backup ok — $(ls -lh $DEST/db-$STAMP.sql.gz | awk '{print $5}') db, $(ls -lh $DEST/storage-$STAMP.tgz 2>/dev/null | awk '{print $5}') storage"

# ---- offsite encrypted copy -> Mac mini (added 2026-07-07) ----
# age-encrypts both artifacts to a PUBLIC recipient whose PRIVATE key lives ONLY on Richard's
# MacBook (~/.config/age/berwilson-offsite-backup.key) + his password manager — a stolen
# Studio or mini cannot decrypt. Non-fatal: a mini outage never breaks the local backup above.
AGE_RECIPIENT="age1q85gt646wmguldvruj8xfq25vmc0asj7js4xn67095ykqd9mzqsq4j7zc2"
# MagicDNS short name, not a 100.x literal: a Tailscale account/tailnet change
# reassigns every node IP, and a hardcoded one fails here SILENTLY (BatchMode=yes
# suppresses the host-key prompt). known_hosts is keyed by this hostname
# (CheckHostIP=no), so it survives both the IP and the MagicDNS-suffix changing.
MINI_HOST="richards-mac-mini"
# Resolve through Tailscale rather than DNS. MagicDNS works from an interactive
# shell but resolved as NXDOMAIN under launchd on 2026-09-16..23 ("Could not
# resolve hostname richards-mac-mini"), which BatchMode=yes then reports as a
# plain failure. `tailscale ip` asks the tailnet directly, so it needs no
# resolver, and it still reads the CURRENT address rather than a hardcoded one.
MINI_ADDR=$(tailscale ip -4 "$MINI_HOST" 2>/dev/null | head -1)
[ -z "$MINI_ADDR" ] && MINI_ADDR="$MINI_HOST"
MINI="richardwhite@$MINI_ADDR"
# Connect by IP, but verify the host key under the NAME. known_hosts is keyed
# by "richards-mac-mini" (4 entries, none by address), so dialling the literal
# IP alone fails "Host key verification failed" under BatchMode=yes — which is
# exactly what happened the first time this was changed, on 2026-09-23.
# HostKeyAlias keeps both properties: no resolver needed, key still checked.
MINI_SSH_OPTS=(-o "HostKeyAlias=$MINI_HOST" -o CheckHostIP=no)
MINI_DEST="Backups/berwilson-offsite"
# Retries are belt-and-braces, NOT the fix for the 2026-09-16..23 outage.
# Checked rather than assumed: the mini had `sleep 0` and 7 days uptime across
# that whole window, so it was never asleep — the cause was the tailnet move on
# 2026-09-16 renumbering every node (the script then held the old 100.74.2.126
# and timed out), and MagicDNS short names not resolving under launchd once it
# was switched to a hostname. Resolving through `tailscale ip` above addresses
# both. These retries only cover a transient link drop, which this box does
# have: the push is ~1GB at ~17MB/min over the tailnet, so it is in flight for
# the better part of an hour and has time to be interrupted.
OFFSITE_TRIES=6
OFFSITE_WAIT=300
OFFSITE_STATUS="$DEST/.offsite-status"
set +e

# ---- secrets bundle (added 2026-08-25) ----
# The database and storage were always covered; the credentials that make them
# reachable were not. On 2026-08-25 a crash took ~/berwilson-data with it,
# destroying the Google OAuth client secret and every mailbox refresh token —
# unrecoverable from anything on this machine, and it killed all mail, calendar
# and Drive access until a human re-consented in a browser.
#
# .env.local is the same class of problem: gitignored, single copy, and holding
# the service-role key, CRON_SECRET and every Supabase key.
#
# These are a few KB. The plaintext tar is written with a private umask, lives
# only long enough to be encrypted, and is deleted immediately — it is NEVER
# kept locally and never leaves unencrypted, unlike the db/storage artifacts
# whose local copies are plaintext by the original design.
# Only bundle what actually exists — tar exits nonzero on a missing member, and
# a missing tokens file (the normal state between a loss and a re-consent) must
# not stop .env.local from being backed up.
SECRETS_PLAIN="$DEST/.secrets-$STAMP.tgz"
SECRET_FILES=()
for f in berwilson-platform/.env.local berwilson-data/google-oauth-tokens.json; do
  [ -f "$HOME/$f" ] && SECRET_FILES+=("$f")
done
SECRETS_OK=1
if [ ${#SECRET_FILES[@]} -gt 0 ]; then
  ( umask 077; tar -czf "$SECRETS_PLAIN" -C $HOME "${SECRET_FILES[@]}" )
  SECRETS_OK=$?
fi

if command -v age >/dev/null 2>&1 && [ -n "$AGE_RECIPIENT" ]; then
  age -r "$AGE_RECIPIENT" -o "$DEST/db-$STAMP.sql.gz.age" "$DEST/db-$STAMP.sql.gz"
  E1=$?
  age -r "$AGE_RECIPIENT" -o "$DEST/storage-$STAMP.tgz.age" "$DEST/storage-$STAMP.tgz"
  E2=$?
  E3=1
  if [ $SECRETS_OK -eq 0 ] && [ -s "$SECRETS_PLAIN" ]; then
    age -r "$AGE_RECIPIENT" -o "$DEST/secrets-$STAMP.tgz.age" "$SECRETS_PLAIN"
    E3=$?
  else
    echo "$(date): WARN secrets bundle not built (found: ${SECRET_FILES[*]:-none})"
  fi
  # Plaintext secrets never outlive the encryption step, whatever happened above.
  rm -f "$SECRETS_PLAIN"

  if [ $E1 -eq 0 ] && [ $E2 -eq 0 ]; then
    PUSH="$DEST/db-$STAMP.sql.gz.age $DEST/storage-$STAMP.tgz.age"
    [ $E3 -eq 0 ] && PUSH="$PUSH $DEST/secrets-$STAMP.tgz.age"
    PUSHED=1
    ATTEMPT=1
    while [ $ATTEMPT -le $OFFSITE_TRIES ]; do
      ssh -o ConnectTimeout=10 -o BatchMode=yes "${MINI_SSH_OPTS[@]}" "$MINI" "mkdir -p $MINI_DEST" \
        && rsync -a -e "ssh -o ConnectTimeout=10 -o BatchMode=yes -o HostKeyAlias=$MINI_HOST -o CheckHostIP=no" \
             ${=PUSH} "$MINI:$MINI_DEST/"
      if [ $? -eq 0 ]; then PUSHED=0; break; fi
      [ $ATTEMPT -lt $OFFSITE_TRIES ] && \
        echo "$(date): offsite attempt $ATTEMPT/$OFFSITE_TRIES failed ($MINI_ADDR) — retrying in ${OFFSITE_WAIT}s" && \
        sleep $OFFSITE_WAIT
      ATTEMPT=$((ATTEMPT + 1))
    done
    if [ $PUSHED -eq 0 ]; then
      ssh -o BatchMode=yes "${MINI_SSH_OPTS[@]}" "$MINI" "find $MINI_DEST -name '*.age' -type f -mtime +14 -delete" 2>/dev/null
      echo "$(date): offsite copy pushed to mini:$MINI_DEST$([ $E3 -eq 0 ] && echo ' (incl. secrets)') (attempt $ATTEMPT)"
      # Marker the health page reads. Without it a failed offsite push is
      # invisible: probeBackups only ever stat'd the LOCAL artifacts, so six
      # consecutive nights with no disaster-recovery copy reported "ok".
      printf '{"ok":true,"at":"%s","secrets":%s,"target":"%s"}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$([ $E3 -eq 0 ] && echo true || echo false)" "$MINI_ADDR" > "$OFFSITE_STATUS"
    else
      echo "$(date): WARN offsite push FAILED after $OFFSITE_TRIES attempts (mini unreachable at $MINI_ADDR, asleep, or Studio key not authorized)"
      printf '{"ok":false,"at":"%s","detail":"push failed after %s attempts to %s"}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OFFSITE_TRIES" "$MINI_ADDR" > "$OFFSITE_STATUS"
    fi
  else
    echo "$(date): WARN offsite encryption failed (e1=$E1 e2=$E2)"
  fi
  rm -f "$DEST/db-$STAMP.sql.gz.age" "$DEST/storage-$STAMP.tgz.age" "$DEST/secrets-$STAMP.tgz.age"
else
  rm -f "$SECRETS_PLAIN"
  echo "$(date): WARN offsite skipped (age missing or recipient unset) — secrets NOT backed up"
fi
set -e
