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

# ⚠ PRIVATE BY DEFAULT, FOR EVERYTHING THIS SCRIPT WRITES — not just the
# secrets tar further down, which was the only thing that set its own umask.
# A `pg_dumpall` IS the database: every contact, every commitment, and every
# confidential project, in plaintext. These landed 0644 in a 0755 directory.
#
# ⚠ AND THIS IS THE WHOLE FIX ON PURPOSE. Encrypting them locally was the
# obvious move and would have been theatre: the key would have to live on this
# same box, readable by this same user — who can already read `.env.local` and
# query Postgres directly. Measured 2026-10-21 before deciding: FileVault is
# ON, there is no Time Machine destination configured, and the directory is
# not inside any cloud-synced folder, so the dumps never leave the encrypted
# volume. The offsite copy on Drive is separately age-encrypted with a key held
# off-box. What was actually wrong was the file mode, so that is what changed.
umask 077

STAMP=$(date +%Y%m%d-%H%M)
DEST=$HOME/Backups/berwilson
mkdir -p "$DEST"
chmod 700 "$DEST"
docker exec supabase-db pg_dumpall -U postgres | gzip > "$DEST/db-$STAMP.sql.gz"
tar -czf "$DEST/storage-$STAMP.tgz" -C $HOME/supabase-selfhost/docker/volumes storage 2>/dev/null || true
# retention: keep 14 days
find "$DEST" -name "*.gz" -o -name "*.tgz" | while read f; do
  [ $(( ($(date +%s) - $(stat -f %m "$f")) / 86400 )) -gt 14 ] && rm "$f" || true
done
echo "$(date): backup ok — $(ls -lh $DEST/db-$STAMP.sql.gz | awk '{print $5}') db, $(ls -lh $DEST/storage-$STAMP.tgz 2>/dev/null | awk '{print $5}') storage"

# ---- offsite encrypted copy (age) ----
# age-encrypts the artifacts to a PUBLIC recipient whose PRIVATE key lives ONLY on
# Richard's MacBook (~/.config/age/berwilson-offsite-backup.key) + his password
# manager — a stolen Studio cannot decrypt, and neither can Google.
AGE_RECIPIENT="age1q85gt646wmguldvruj8xfq25vmc0asj7js4xn67095ykqd9mzqsq4j7zc2"
#
# ⚠ THE MAC MINI DESTINATION WAS REMOVED 2026-10-21 (Richard's call). Google
# Drive replaced it; the push lives further down. Why, so nobody re-adds it
# without knowing what it cost:
#   - The mini had 37GB free TOTAL and this held 25GB of it, at 83% capacity
#     and growing (the storage tarball went 1.1GB -> 1.6GB in two weeks).
#   - The GSuite pooled quota is 6,597GB with 17.6GB used. 30 nights is <1%.
#   - It was NOT removed for security: the mini only ever held the same age
#     ciphertext Drive now holds, and could not read it either.
# What was lost by removing it, stated plainly: the mini was a destination with
# an INDEPENDENT credential (an ssh key) and no dependency on Google. Drive
# authenticates with the OAuth token store, which is ITSELF one of the files
# backed up — so a loss of ~/berwilson-data could take the uploader's
# credential with it. That is mitigated, not eliminated: drive-backup-push.mjs
# keeps a second copy of the token store at ~/.config/bw-backup/ (a different
# blast radius from the 2026-08-25 crash, which took ~/berwilson-data whole).
# If a second independent destination is ever wanted again, THAT is the gap it
# fills — not space, and not secrecy.
#
# The mini's `.offsite-status` marker is no longer written, and probeOffsite in
# src/lib/system-health.ts deliberately does NOT fall back to it: a stale
# marker from a decommissioned destination would report a copy that no longer
# happens, which is the exact failure the probe exists to catch.
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

    # ---- offsite encrypted copy -> Google Drive (added 2026-10-21) ----
    # Richard's call: the GSuite pooled quota is 6,597GB with 17.6GB used, so a
    # 30-night window (~50GB) is under 1% of it, where the mini had 37GB free
    # TOTAL and the backups were 25GB of that.
    #
    # It pushes the SAME age ciphertext as the mini, so Google holds opaque
    # bytes it cannot read — the private key is on Richard's MacBook and in his
    # password manager, on no machine that writes here. That is what makes this
    # consistent with §2's "nothing leaves his hardware": what leaves is
    # unreadable without a key that never does.
    #
    # Runs BEFORE the mini push, not after: the mini block sleeps up to 25
    # minutes across its 6 retries when that box is unreachable, and the real
    # offsite copy should not queue behind a machine being decommissioned.
    #
    # Non-fatal by the same rule as the mini push — a Drive or network outage
    # must never break the local backup above.
    DRIVE_PUSH_SCRIPT="$HOME/berwilson-platform/deploy/drive-backup-push.mjs"
    # Resolve node explicitly. launchd hands this script a minimal PATH, and a
    # missing interpreter is precisely the silent outage §12 warns about — so it
    # is reported as a WARN with the paths tried, never skipped quietly.
    NODE_BIN=""
    for n in "$HOME/.local/bin/node" "$HOME/.node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
      [ -x "$n" ] && NODE_BIN="$n" && break
    done
    DRIVE_STATUS="$DEST/.drive-status"
    if [ -z "$NODE_BIN" ]; then
      echo "$(date): WARN drive push SKIPPED — no node found (~/.local/bin, ~/.node/bin, homebrew, /usr/local)"
      printf '{"ok":false,"at":"%s","detail":"no node interpreter found"}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DRIVE_STATUS"
    elif [ ! -f "$DRIVE_PUSH_SCRIPT" ]; then
      echo "$(date): WARN drive push SKIPPED — $DRIVE_PUSH_SCRIPT missing"
      printf '{"ok":false,"at":"%s","detail":"uploader script missing"}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DRIVE_STATUS"
    else
      # The script writes its own status marker (ok/failed, what it uploaded,
      # what it pruned, and whether it had to RECREATE a deleted folder).
      BACKUP_DIR="$DEST" "$NODE_BIN" "$DRIVE_PUSH_SCRIPT" ${=PUSH}
      [ $? -ne 0 ] && echo "$(date): WARN drive push FAILED — see $DRIVE_STATUS"
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
