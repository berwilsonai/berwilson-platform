#!/bin/zsh
# Asserts the Studio's Tailscale serve configuration and keeps .env.local in step
# with the tailnet's current hostname.
#
# WHY THIS EXISTS
#   1. The serve config is Tailscale's state, not ours. A logout, an app upgrade or a
#      reinstall wipes it. When the :8443 listener vanishes the app cannot reach its own
#      database and serves /login while every data path fails — which reads as "the
#      platform is broken", not "a proxy is missing" (this exact outage happened
#      2026-09-09). The old assertion lived in deploy-to-studio.sh, which was retired
#      when the Studio became the repo, so nothing has re-established it since.
#   2. NEXT_PUBLIC_* is compiled into the bundle at BUILD time. Changing the tailnet —
#      a new account, a new org — changes the MagicDNS suffix, so the baked Supabase
#      URL points at a host that no longer exists. That needs an env edit AND a rebuild;
#      a restart alone is not enough.
#
# USAGE
#   zsh deploy/tailnet-setup.sh          # check + assert serve; report env drift
#   zsh deploy/tailnet-setup.sh --fix    # also rewrite .env.local to the live hostname
set -u
cd "$(dirname "$0")/.." || exit 1

TAILSCALE=/usr/local/bin/tailscale
ENV_FILE="$PWD/.env.local"
FIX=0
[[ "${1:-}" == "--fix" ]] && FIX=1

b() { print -P "%B$1%b" }
ok()   { print "  ✓ $1" }
warn() { print "  ! $1" }
bad()  { print "  ✗ $1" }
FAIL=0

b "1. Tailscale"
if [[ ! -x $TAILSCALE ]]; then bad "tailscale CLI not at $TAILSCALE"; exit 1; fi
STATE=$($TAILSCALE status --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin).get("BackendState",""))' 2>/dev/null)
if [[ "$STATE" != "Running" ]]; then
  bad "backend state is '${STATE:-unknown}' — sign in first: tailscale login"
  exit 1
fi
eval "$($TAILSCALE status --json | python3 -c '
import json,sys
d=json.load(sys.stdin); s=d.get("Self",{})
fqdn=(s.get("DNSName") or "").rstrip(".")
tn=(d.get("CurrentTailnet") or {}).get("Name","")
exp=s.get("KeyExpiry") or ""
ip=(s.get("TailscaleIPs") or [""])[0]
for k,v in (("FQDN",fqdn),("TAILNET",tn),("KEYEXP",exp),("TSIP",ip)):
    print(f"{k}={v!r}".replace("'"'"'","'"'"'"))
' | sed "s/^/export /")"
ok "tailnet:  ${TAILNET}"
ok "hostname: ${FQDN}"
ok "ip:       ${TSIP}"
if [[ -n "$KEYEXP" ]]; then
  warn "node key EXPIRES ${KEYEXP} — disable key expiry on this device in the admin"
  warn "console, or the platform silently drops off the tailnet on that date"
else
  ok "key expiry disabled (correct for a server)"
fi

b "\n2. Serve listeners"
# macOS ships no timeout(1). This matters: on a tailnet where Serve has never been
# enabled, `tailscale serve` prints a one-click enable URL and then BLOCKS, polling
# until a human clicks it. Capturing that output to /dev/null turns a clear, actionable
# message into an unexplained hang — which is exactly what happened on 2026-09-16.
# /usr/local/bin/tailscale is a /bin/sh WRAPPER that execs the real binary inside
# Tailscale.app — killing the subshell leaves the grandchild polling forever, so the
# timeout must reap the whole tree. `serve --bg` returns instantly when it works, so a
# surviving `tailscale serve` process is by definition the stuck one.
cap() {
  local s=$1; shift
  local f=$(mktemp); ( "$@" >$f 2>&1 ) & local p=$! rc=0 i=0
  while (( i < s )); do kill -0 $p 2>/dev/null || break; sleep 1; (( i++ )); done
  if kill -0 $p 2>/dev/null; then pkill -f "tailscale serve" 2>/dev/null; rc=143; else wait $p 2>/dev/null; rc=$?; fi
  cat $f; rm -f $f; return $rc
}
serve_set() { # <label> <args...>
  local label=$1; shift
  local out; out=$(cap 20 $TAILSCALE serve "$@" 2>&1); local rc=$?
  # Exit 0 is the whole signal. Creating a listener prints a success banner while a
  # no-op re-run is silent, so requiring empty output reported a working listener as
  # a failure on the very run that established it.
  if [[ $rc -eq 0 ]]; then ok "$label"; return 0; fi
  bad "$label — could not set listener"
  [[ -n "$out" ]] && print "$out" | sed 's/^/      /'
  if print -r -- "$out" | grep -qi 'not enabled'; then
    warn "Serve is not enabled on this tailnet. Open the URL above and click enable"
    warn "(it turns on HTTPS certificates too), then re-run this script."
  elif [[ $rc -eq 143 ]]; then
    warn "timed out — the command was waiting on a browser action. Check the URL above."
  fi
  FAIL=1; return 1
}
# Idempotent: re-running an identical mapping is a no-op.
serve_set "443  -> 127.0.0.1:3000 (app)"            --bg 3000
serve_set "8443 -> 127.0.0.1:8000 (supabase/kong)"  --bg --https=8443 http://localhost:8000
print
cap 10 $TAILSCALE serve status 2>&1 | sed 's/^/  /'

b "\n3. .env.local vs live hostname"
WANT_SUPA="https://${FQDN}:8443"
WANT_APP="https://${FQDN}"
CUR_SUPA=$(grep -m1 '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
CUR_APP=$(grep -m1 '^APP_URL=' "$ENV_FILE" | cut -d= -f2-)
DRIFT=0
[[ "$CUR_SUPA" == "$WANT_SUPA" ]] && ok "NEXT_PUBLIC_SUPABASE_URL matches" || { DRIFT=1; bad "NEXT_PUBLIC_SUPABASE_URL is $CUR_SUPA"; print "      want: $WANT_SUPA" }
[[ "$CUR_APP"  == "$WANT_APP"  ]] && ok "APP_URL matches"                 || { DRIFT=1; bad "APP_URL is $CUR_APP";                 print "      want: $WANT_APP" }

if (( DRIFT )) && (( FIX )); then
  cp "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
  python3 - "$ENV_FILE" "$WANT_SUPA" "$WANT_APP" <<'PY'
import sys,re
p,supa,app=sys.argv[1:4]
out=[]
for line in open(p):
    if line.startswith('NEXT_PUBLIC_SUPABASE_URL='): line=f'NEXT_PUBLIC_SUPABASE_URL={supa}\n'
    elif line.startswith('APP_URL='):                 line=f'APP_URL={app}\n'
    out.append(line)
open(p,'w').writelines(out)
PY
  ok "rewrote .env.local (backup kept alongside it)"
  DRIFT=2
fi

b "\n4. Supabase (GoTrue) vs live hostname"
# .env.local is only HALF the hostname config. GoTrue keeps its own copy in the
# self-hosted stack's .env, and that is what gets baked into every recovery / invite /
# magic link it generates. When the tailnet moved on 2026-09-16 this half was missed, so
# GoTrue kept minting links pointing at a hostname that no longer resolved — clicking one
# gives "site can't be reached", which reads to a user as a broken password. Nothing else
# asserted this, so it is asserted here beside its counterpart.
SUPA_ENV="$HOME/supabase-selfhost/docker/.env"
SDRIFT=0
if [[ -f $SUPA_ENV ]]; then
  for k w in API_EXTERNAL_URL "$WANT_SUPA" SUPABASE_PUBLIC_URL "$WANT_SUPA" SITE_URL "$WANT_APP"; do
    c=$(grep -m1 "^${k}=" "$SUPA_ENV" | cut -d= -f2-)
    if [[ "$c" == "$w" ]]; then ok "$k matches"
    else SDRIFT=1; bad "$k is ${c:-<unset>}"; print "      want: $w"; fi
  done

  if (( SDRIFT )) && (( FIX )); then
    cp "$SUPA_ENV" "$SUPA_ENV.bak-$(date +%Y%m%d-%H%M%S)"
    sed -i '' \
      -e "s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=${WANT_SUPA}|" \
      -e "s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=${WANT_SUPA}|" \
      -e "s|^SITE_URL=.*|SITE_URL=${WANT_APP}|" \
      "$SUPA_ENV"
    ok "rewrote supabase .env (backup kept alongside it)"
    # GoTrue reads these only at container start — recreate, a restart is not enough.
    if ( export PATH="$HOME/.local/bin:$PATH" DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
         cd "$HOME/supabase-selfhost/docker" && docker compose -f docker-compose.lean.yml up -d auth ) >/dev/null 2>&1
    then ok "recreated supabase-auth on the new hostname"
    else bad "could not recreate supabase-auth — do it by hand"; FAIL=1; fi
    SDRIFT=0
  fi
else
  warn "no supabase .env at $SUPA_ENV — skipping (not the Studio?)"
fi
(( SDRIFT )) && FAIL=1

b "\n5. Reachability"
# 25s, not 10: the FIRST request to a new tailnet hostname blocks while Tailscale
# provisions the Let's Encrypt certificate. A short timeout reports 000 and reads as
# "the platform is unreachable" when it is merely issuing a cert.
code() { curl -sk -o /dev/null -m 25 -w '%{http_code}' "$1" 2>/dev/null || echo 000 }
C1=$(code http://localhost:3000/login);           [[ $C1 == 200 ]] && ok "localhost:3000/login -> 200" || { bad "localhost:3000/login -> $C1"; FAIL=1 }
C2=$(code "https://${FQDN}/login");               [[ $C2 == 200 ]] && ok "tailnet 443 /login -> 200"   || { bad "tailnet 443 /login -> $C2"; FAIL=1 }
C3=$(code "https://${FQDN}:8443/auth/v1/health"); [[ $C3 == 200 || $C3 == 401 ]] && ok "tailnet 8443 supabase -> $C3 (reachable)" || { bad "tailnet 8443 -> $C3"; FAIL=1 }

b "\n6. Next step"
if (( DRIFT == 1 )); then
  print "  .env.local is STALE. Re-run with --fix, then REBUILD (a restart is not enough —"
  print "  NEXT_PUBLIC_* is baked into the bundle at build time):"
  print "    export PATH=\"\$HOME/.node/bin:\$PATH\" && npm run build"
  print "    launchctl kickstart -k gui/\$(id -u)/com.berwilson.platform"
elif (( DRIFT == 2 )); then
  print "  .env.local updated. Now REBUILD and restart:"
  print "    export PATH=\"\$HOME/.node/bin:\$PATH\" && npm run build"
  print "    launchctl kickstart -k gui/\$(id -u)/com.berwilson.platform"
elif (( FAIL )); then
  print "  Some checks failed above — fix those before assuming the platform is healthy."
else
  print "  Nothing to do. Serve config asserted, env matches, all three endpoints answer."
fi
exit $FAIL
