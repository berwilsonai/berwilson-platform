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
# Idempotent: re-running an identical mapping is a no-op.
$TAILSCALE serve --bg 3000 >/dev/null 2>&1 \
  && ok "443  -> 127.0.0.1:3000 (app)" \
  || { bad "could not set 443 listener — is HTTPS Certificates enabled in DNS settings?"; FAIL=1; }
$TAILSCALE serve --bg --https=8443 http://localhost:8000 >/dev/null 2>&1 \
  && ok "8443 -> 127.0.0.1:8000 (supabase/kong)" \
  || { bad "could not set 8443 listener"; FAIL=1; }
print
$TAILSCALE serve status 2>&1 | sed 's/^/  /'

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

b "\n4. Reachability"
code() { curl -sk -o /dev/null -m 10 -w '%{http_code}' "$1" 2>/dev/null || echo 000 }
C1=$(code http://localhost:3000/login);           [[ $C1 == 200 ]] && ok "localhost:3000/login -> 200" || { bad "localhost:3000/login -> $C1"; FAIL=1 }
C2=$(code "https://${FQDN}/login");               [[ $C2 == 200 ]] && ok "tailnet 443 /login -> 200"   || { bad "tailnet 443 /login -> $C2"; FAIL=1 }
C3=$(code "https://${FQDN}:8443/auth/v1/health"); [[ $C3 == 200 || $C3 == 401 ]] && ok "tailnet 8443 supabase -> $C3 (reachable)" || { bad "tailnet 8443 -> $C3"; FAIL=1 }

b "\n5. Next step"
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
