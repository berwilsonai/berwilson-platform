#!/bin/zsh
# Deploy the Ber Wilson platform to the Mac Studio (Tailscale-only hosting).
# Run from the repo root on the MacBook:  zsh deploy/deploy-to-studio.sh
# Idempotent — run again to redeploy after changes.
set -euo pipefail

STUDIO="${STUDIO_HOST:-richardwhite@100.86.79.4}"
APP_DIR='$HOME/berwilson-platform'   # expanded on the Studio
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAILSCALE=/Applications/Tailscale.app/Contents/MacOS/Tailscale

NODE_BIN='$HOME/.node/bin'  # expanded on the Studio (no-sudo Node install; see README)

echo "==> Preflight"
ssh -o ConnectTimeout=8 "$STUDIO" 'echo "  ssh ok: $(hostname)"'
ssh "$STUDIO" "export PATH=$NODE_BIN:\$PATH; command -v node >/dev/null && echo \"  node: \$(node --version)\" || { echo '  ERROR: node not installed on Studio — see deploy/README.md'; exit 1; }"
ssh "$STUDIO" 'curl -sS -m 5 http://localhost:1234/v1/models >/dev/null && echo "  LM Studio: reachable on localhost:1234" || echo "  WARN: LM Studio not answering on localhost:1234 — AI calls will fail until it is running"'
# Literal home path on the Studio — the generated .env.local is read by Node,
# which does no shell expansion, so absolute paths have to be baked in.
STUDIO_HOME="$(ssh "$STUDIO" 'echo $HOME')"
# This org blocks service account key downloads, so the Studio signs remotely
# via IAM signJwt using gcloud's Application Default Credentials.
# Mail auth is per-mailbox OAuth (this Cloud org blocks service account keys).
if ssh "$STUDIO" '[ -s berwilson-data/google-oauth-tokens.json ]'; then
  echo "  Google mailbox consent: present"
else
  echo "  WARN: no google-oauth-tokens.json on the Studio — mail, calendar, and the sweep will be offline."
  echo "        Fix: node scripts/setup-google-oauth.mjs   (then scp it to the Studio)"
  echo "        See deploy/google-workspace-setup.md."
fi

echo "==> Syncing source to Studio:$APP_DIR"
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude .next \
  --exclude '.env*' --exclude '*.log' \
  "$REPO_ROOT/" "$STUDIO:berwilson-platform/"

echo "==> Checking map data (basemap tiles for /map)"
# Push-once: the Studio's archive may be a bigger extract (full CONUS) than the
# MacBook's dev copy (Utah) — never overwrite it. Manage upgrades manually
# (see scripts/setup-map-data.sh + deploy/README.md).
if ssh "$STUDIO" '[ -s berwilson-data/maps/us.pmtiles ]'; then
  echo "  basemap already on Studio — leaving it alone"
elif [ -s "$HOME/berwilson-data/maps/us.pmtiles" ]; then
  echo "  pushing basemap to Studio (first time)"
  rsync -az "$HOME/berwilson-data/maps/us.pmtiles" "$STUDIO:berwilson-data/maps/"
else
  echo "  WARN: no basemap anywhere — run scripts/setup-map-data.sh; /map will show a basemap error"
fi
# World overview (z0-7, ~200MB) — same push-once rule.
if ssh "$STUDIO" '[ -s berwilson-data/maps/world.pmtiles ]'; then
  echo "  world overview already on Studio — leaving it alone"
elif [ -s "$HOME/berwilson-data/maps/world.pmtiles" ]; then
  echo "  pushing world overview to Studio (first time)"
  rsync -az "$HOME/berwilson-data/maps/world.pmtiles" "$STUDIO:berwilson-data/maps/"
else
  echo "  WARN: no world overview — run scripts/setup-map-data.sh; world zoom will be regions-only"
fi

echo "==> Building Studio env file"
ENV_TMP="$(mktemp)"
trap 'rm -f "$ENV_TMP"' EXIT
# Start from the MacBook env, then adapt for the Studio:
#  - LM Studio is on the same machine there -> localhost
#  - drop Vercel-only vars
#  - repoint any Google key path at the Studio's own copy (unused in the
#    keyless signJwt setup, but harmless and correct if a key is ever allowed)
grep -v '^VERCEL_OIDC_TOKEN=' "$REPO_ROOT/.env.local" \
  | sed 's#^LOCAL_AI_BASE_URL=.*#LOCAL_AI_BASE_URL=http://localhost:1234/v1#' \
  | sed 's#^GOOGLE_SERVICE_ACCOUNT_KEY_FILE=.*#GOOGLE_SERVICE_ACCOUNT_KEY_FILE='"$STUDIO_HOME"'/berwilson-data/google-service-account.json#' \
  | sed 's#^GOOGLE_OAUTH_TOKENS_FILE=.*#GOOGLE_OAUTH_TOKENS_FILE='"$STUDIO_HOME"'/berwilson-data/google-oauth-tokens.json#' > "$ENV_TMP"
if ! grep -q '^CRON_SECRET=' "$ENV_TMP"; then
  echo "CRON_SECRET=$(openssl rand -hex 32)" >> "$ENV_TMP"
  echo "  generated new CRON_SECRET for the Studio"
fi
# Local Whisper transcription (whisper.cpp + Metal, built on the Studio). These
# paths are Studio-specific, so they're set here rather than in the MacBook env.
# afconvert (macOS built-in) decodes m4a → wav; whisper-cli reads the wav.
if ! grep -q '^WHISPER_BIN=' "$ENV_TMP"; then
  WHISPER_BIN_PATH="${WHISPER_BIN_PATH:-$HOME/whisper.cpp/build/bin/whisper-cli}"
  WHISPER_MODEL_PATH="${WHISPER_MODEL_PATH:-$HOME/whisper.cpp/models/ggml-large-v3-turbo.bin}"
  {
    echo "WHISPER_BIN=$WHISPER_BIN_PATH"
    echo "WHISPER_MODEL=$WHISPER_MODEL_PATH"
  } >> "$ENV_TMP"
  echo "  wired Whisper transcription (WHISPER_BIN/WHISPER_MODEL)"
fi
scp -q "$ENV_TMP" "$STUDIO:berwilson-platform/.env.local"

echo "==> Installing dependencies + building (this takes a few minutes)"
ssh "$STUDIO" "export PATH=$NODE_BIN:\$PATH; cd $APP_DIR && npm ci --no-audit --no-fund && npm run build" | tail -3

echo "==> Installing launchd services"
ssh "$STUDIO" "
  set -e
  mkdir -p \$HOME/Library/Logs/berwilson \$HOME/Library/LaunchAgents
  for plist in com.berwilson.platform com.berwilson.cron-daily-brief com.berwilson.cron-risk-scores com.berwilson.cron-email-sweep com.berwilson.cron-task-digest com.berwilson.cron-lead-sweep com.berwilson.cron-drive-sync com.berwilson.cron-drive-publish com.berwilson.cron-contacts-sync com.berwilson.cron-meet-import; do
    sed -e \"s#__APP_DIR__#\$HOME/berwilson-platform#g\" -e \"s#__LOG_DIR__#\$HOME/Library/Logs/berwilson#g\" -e \"s#__NODE_BIN__#\$HOME/.node/bin#g\" \
      $APP_DIR/deploy/\$plist.plist > \$HOME/Library/LaunchAgents/\$plist.plist
    launchctl bootout gui/\$(id -u)/\$plist 2>/dev/null || true
    # bootout is ASYNC. A fixed sleep raced it and left com.berwilson.platform
    # unloaded entirely (2026-08-23), so poll until it is really gone.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      launchctl list 2>/dev/null | grep -q \$plist || break
      sleep 1
    done
    launchctl bootstrap gui/\$(id -u) \$HOME/Library/LaunchAgents/\$plist.plist 2>/dev/null \
      || launchctl kickstart gui/\$(id -u)/\$plist 2>/dev/null \
      || { sleep 3; launchctl bootstrap gui/\$(id -u) \$HOME/Library/LaunchAgents/\$plist.plist 2>/dev/null; }
    # Confirm it came back rather than assuming it did.
    if launchctl list 2>/dev/null | grep -q \$plist; then
      echo \"    \$plist: loaded\"
    else
      echo \"    \$plist: FAILED TO LOAD\"
    fi
  done
  echo '  services installed'
"

echo "==> Enabling Tailscale serve (HTTPS inside the tailnet only)"
ssh "$STUDIO" "$TAILSCALE serve --bg 3000 2>&1 | grep -v '^$' | head -5" || echo "  WARN: tailscale serve failed — app still reachable at http://100.86.79.4:3000 inside the tailnet"

echo "==> Health check"
# `next start` needs ~10s to listen. A single probe 5s in reported HTTP 000 on
# a perfectly good deploy (2026-08-23), so poll for up to 60s before judging.
ssh "$STUDIO" 'CODE=000
for i in $(seq 1 20); do
  CODE=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" http://localhost:3000/login 2>/dev/null || echo 000)
  [ "$CODE" = "200" ] && { echo "  app responding on localhost:3000 (HTTP 200)"; exit 0; }
  sleep 3
done
echo "  WARN: app did NOT respond within 60s (last HTTP $CODE)"
echo "        check: tail ~/Library/Logs/berwilson/platform.err.log"
exit 1' || true

echo "==> Done. Reminders:"
echo "  - Keep the Studio awake: System Settings -> Energy -> Prevent automatic sleeping ON"
echo "  - Services run as LaunchAgents: enable auto-login on the Studio so they start after a reboot"
echo "  - LM Studio must be set to run at login with the server enabled"
