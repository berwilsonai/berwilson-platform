#!/bin/zsh
# Prints a ready-to-paste ACL with this tailnet's live values substituted in.
# The two tailnet-specific values (admin login, Studio IP) both change when the
# tailnet changes, and a wrong IP in rule 2 silently exposes every Studio port.
set -eu
cd "$(dirname "$0")"
eval "$(/usr/local/bin/tailscale status --json | python3 -c '
import json,sys
d=json.load(sys.stdin); s=d.get("Self",{})
u=list((d.get("User") or {}).values())
print("ADMIN=%s" % (u[0]["LoginName"] if u else "UNKNOWN"))
print("STUDIO_IP=%s" % (s.get("TailscaleIPs") or ["UNKNOWN"])[0])
')"
print -u2 "# admin=$ADMIN studio=$STUDIO_IP  (paste into https://login.tailscale.com/admin/acls)"
[[ $ADMIN == UNKNOWN || $STUDIO_IP == UNKNOWN ]] && { print -u2 "ERROR: not signed in"; exit 1; }
sed -e "s|__ADMIN__|$ADMIN|g" -e "s|__STUDIO_IP__|$STUDIO_IP|g" tailscale-acl.hujson
