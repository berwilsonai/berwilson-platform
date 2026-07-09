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

echo "==> Syncing source to Studio:$APP_DIR"
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude .next \
  --exclude '.env*' --exclude '*.log' \
  "$REPO_ROOT/" "$STUDIO:berwilson-platform/"

echo "==> Syncing map data (basemap tiles for /map)"
if [ -d "$HOME/berwilson-data/maps" ]; then
  rsync -az "$HOME/berwilson-data/maps/" "$STUDIO:berwilson-data/maps/"
  echo "  map data in sync"
else
  echo "  WARN: ~/berwilson-data/maps not found — run scripts/setup-map-data.sh; /map will show a basemap error"
fi

echo "==> Building Studio env file"
ENV_TMP="$(mktemp)"
trap 'rm -f "$ENV_TMP"' EXIT
# Start from the MacBook env, then adapt for the Studio:
#  - LM Studio is on the same machine there -> localhost
#  - drop Vercel-only vars
grep -v '^VERCEL_OIDC_TOKEN=' "$REPO_ROOT/.env.local" \
  | sed 's#^LOCAL_AI_BASE_URL=.*#LOCAL_AI_BASE_URL=http://localhost:1234/v1#' > "$ENV_TMP"
if ! grep -q '^CRON_SECRET=' "$ENV_TMP"; then
  echo "CRON_SECRET=$(openssl rand -hex 32)" >> "$ENV_TMP"
  echo "  generated new CRON_SECRET for the Studio"
fi
scp -q "$ENV_TMP" "$STUDIO:berwilson-platform/.env.local"

echo "==> Installing dependencies + building (this takes a few minutes)"
ssh "$STUDIO" "export PATH=$NODE_BIN:\$PATH; cd $APP_DIR && npm ci --no-audit --no-fund && npm run build" | tail -3

echo "==> Installing launchd services"
ssh "$STUDIO" "
  set -e
  mkdir -p \$HOME/Library/Logs/berwilson \$HOME/Library/LaunchAgents
  for plist in com.berwilson.platform com.berwilson.cron-daily-brief com.berwilson.cron-risk-scores; do
    sed -e \"s#__APP_DIR__#\$HOME/berwilson-platform#g\" -e \"s#__LOG_DIR__#\$HOME/Library/Logs/berwilson#g\" -e \"s#__NODE_BIN__#\$HOME/.node/bin#g\" \
      $APP_DIR/deploy/\$plist.plist > \$HOME/Library/LaunchAgents/\$plist.plist
    launchctl bootout gui/\$(id -u)/\$plist 2>/dev/null || true
    sleep 2  # bootout is async; immediate bootstrap can hit EIO
    launchctl bootstrap gui/\$(id -u) \$HOME/Library/LaunchAgents/\$plist.plist 2>/dev/null \
      || launchctl kickstart gui/\$(id -u)/\$plist 2>/dev/null \
      || { sleep 3; launchctl bootstrap gui/\$(id -u) \$HOME/Library/LaunchAgents/\$plist.plist; }
  done
  echo '  services installed'
"

echo "==> Enabling Tailscale serve (HTTPS inside the tailnet only)"
ssh "$STUDIO" "$TAILSCALE serve --bg 3000 2>&1 | grep -v '^$' | head -5" || echo "  WARN: tailscale serve failed — app still reachable at http://100.86.79.4:3000 inside the tailnet"

echo "==> Health check"
sleep 5
ssh "$STUDIO" 'curl -sS -m 10 -o /dev/null -w "  app responding on localhost:3000 (HTTP %{http_code})\n" http://localhost:3000/login'

echo "==> Done. Reminders:"
echo "  - Keep the Studio awake: System Settings -> Energy -> Prevent automatic sleeping ON"
echo "  - Services run as LaunchAgents: enable auto-login on the Studio so they start after a reboot"
echo "  - LM Studio must be set to run at login with the server enabled"
