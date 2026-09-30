#!/bin/zsh
# Asserts LM Studio is serving the two models the platform needs, at the load
# settings it was sized for.
#
# WHY THIS EXISTS
#   The load config is LM Studio's state, not ours — exactly like the Tailscale
#   serve config (deploy/tailnet-setup.sh). An app update, or ejecting and
#   reloading a model in the GUI, silently resets it, and every failure mode looks
#   like something else:
#     - context drift costs RAM the app cannot use. Found at 173,824 on 2026-09-30
#       against a documented 131,072 — +1.38 GiB on a 36GB box that was down to
#       314MB free with 10.7 of 12GB swap in use. The agent caps a conversation
#       near 88k tokens (AGENT_CONTEXT_BUDGET_CHARS), so the extra window was
#       unreachable while the machine paged for it.
#     - a model id ending ':2' means a SECOND 22GB copy is resident (41GB against
#       36GB of RAM — seen live). `lms unload` takes no -y; passing it loads
#       another copy.
#     - --parallel reverts to 4. It costs no memory and does not slice the window
#       (measured), but it is not the documented setting.
#     - the EMBEDDING model missing breaks all retrieval while chat still answers,
#       so Ber AI says "I found no correspondence" rather than failing.
#
# USAGE
#   zsh deploy/lmstudio-check.sh          # assert; non-zero exit on drift
#   zsh deploy/lmstudio-check.sh --fix    # reload the chat model at the documented settings
set -u
cd "$(dirname "$0")/.." || exit 1

LMS="$HOME/.lmstudio/bin/lms"
WANT_CTX=131072
WANT_PARALLEL=1
FIX=0
[[ "${1:-}" == "--fix" ]] && FIX=1

b() { print -P "%B$1%b" }
ok()   { print "  ✓ $1" }
warn() { print "  ! $1" }
bad()  { print "  ✗ $1" }
FAIL=0

# The models the app actually asks for, read from .env.local rather than repeated
# here — a second copy of a model id is a second thing to forget to update.
CHAT_MODEL=$(grep -E '^LOCAL_AI_MODEL=' .env.local 2>/dev/null | head -1 | cut -d= -f2-)
EMBED_MODEL=$(grep -E '^LOCAL_EMBEDDING_MODEL=' .env.local 2>/dev/null | head -1 | cut -d= -f2-)

b "1. LM Studio"
if [[ ! -x $LMS ]]; then bad "lms CLI not at $LMS"; exit 1; fi
if [[ -z "$CHAT_MODEL" || -z "$EMBED_MODEL" ]]; then
  bad "LOCAL_AI_MODEL / LOCAL_EMBEDDING_MODEL not both set in .env.local"; exit 1
fi
PS_JSON=$($LMS ps --json 2>/dev/null)
if [[ -z "$PS_JSON" ]]; then bad "lms ps returned nothing — is LM Studio running?"; exit 1; fi
ok "CLI present; app responding"

b "2. Loaded models"
eval "$(print -r -- "$PS_JSON" | CHAT="$CHAT_MODEL" EMBED="$EMBED_MODEL" python3 -c '
import json, os, sys, shlex
rows = json.load(sys.stdin)
chat, embed = os.environ["CHAT"], os.environ["EMBED"]
def emit(k, v): print(f"{k}={shlex.quote(str(v))}")
c = next((r for r in rows if r.get("modelKey") == chat and r.get("type") == "llm"), None)
e = next((r for r in rows if r.get("modelKey") == embed and r.get("type") == "embedding"), None)
emit("CHAT_FOUND", "1" if c else "0")
emit("EMBED_FOUND", "1" if e else "0")
emit("CHAT_CTX", c.get("contextLength", 0) if c else 0)
emit("CHAT_PAR", c.get("parallel", 0) if c else 0)
emit("CHAT_QUANT", (c.get("quantization") or {}).get("name", "?") if c else "?")
# A duplicate copy presents as an identifier suffixed :2, :3 … on the same modelKey.
emit("DUPES", ",".join(r.get("identifier","") for r in rows if ":" in r.get("identifier","").rsplit("/",1)[-1]))
emit("LOADED", ",".join(r.get("identifier","?") for r in rows))
' 2>/dev/null)"

if [[ "${CHAT_FOUND:-0}" != 1 ]]; then
  bad "chat model '$CHAT_MODEL' NOT loaded — every AI call will fail (loaded: ${LOADED:-none})"
  FAIL=1
else
  ok "chat: $CHAT_MODEL ($CHAT_QUANT)"
fi
if [[ "${EMBED_FOUND:-0}" != 1 ]]; then
  bad "embedding model '$EMBED_MODEL' NOT loaded — retrieval returns nothing while chat still answers"
  FAIL=1
else
  ok "embeddings: $EMBED_MODEL"
fi
if [[ -n "${DUPES:-}" ]]; then
  bad "DUPLICATE model copy resident: $DUPES — 'lms unload' it (no -y flag, that loads another)"
  FAIL=1
fi

b "3. Load settings"
if [[ "${CHAT_FOUND:-0}" == 1 ]]; then
  if [[ "${CHAT_CTX:-0}" != "$WANT_CTX" ]]; then
    bad "context is ${CHAT_CTX}, documented $WANT_CTX — AGENT_CONTEXT_BUDGET_CHARS is sized to $WANT_CTX"
    FAIL=1
  else
    ok "context $CHAT_CTX"
  fi
  if [[ "${CHAT_PAR:-0}" != "$WANT_PARALLEL" ]]; then
    warn "parallel is ${CHAT_PAR}, documented $WANT_PARALLEL (costs no memory; the app never issues concurrent requests)"
  else
    ok "parallel $CHAT_PAR"
  fi
fi

b "4. Memory headroom"
# A pass that has to page is slower than one that waits, and OCR beside the model
# is what gets OOM-killed (§12). Report rather than fail: the numbers are the point.
eval "$(python3 -c "
import subprocess, re
sw = subprocess.run(['sysctl','-n','vm.swapusage'], capture_output=True, text=True).stdout
m = re.search(r'used\s*=\s*([\d.]+)M', sw)
print('SWAP_USED=' + (m.group(1) if m else '0'))
vm = subprocess.run(['vm_stat'], capture_output=True, text=True).stdout
def pages(label):
    g = re.search(label + r':\s+(\d+)', vm)
    return int(g.group(1)) if g else 0
mb = (pages('Pages free') + pages('Pages speculative')) * 16384 / 1048576
print('FREE_MB=%.0f' % mb)
")"
print "  swap used: ${SWAP_USED}M   free: ${FREE_MB}MB"
if (( ${SWAP_USED%%.*} > 4096 )); then
  warn "swap over 4GB — the box is paging. Unload the chat model before any OCR or re-embed pass"
fi

if (( FAIL )) && (( FIX )); then
  b "5. Fixing"
  print "  reloading $CHAT_MODEL at -c $WANT_CTX --parallel $WANT_PARALLEL"
  $LMS unload "$CHAT_MODEL" 2>/dev/null
  $LMS load "$CHAT_MODEL" -c $WANT_CTX --parallel $WANT_PARALLEL -y || exit 1
  print "  re-run without --fix to confirm"
  exit 0
fi

print ""
if (( FAIL )); then
  bad "LM Studio is NOT in the documented state — re-run with --fix, or set it in the GUI"
  exit 1
fi
ok "LM Studio matches the documented configuration"
