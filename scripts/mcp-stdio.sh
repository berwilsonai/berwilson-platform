#!/bin/zsh
# Launch the Ber Wilson MCP server over stdio.
#
# This is what an MCP client's `command` points at. It exists because the real
# invocation needs an absolute PATH, an env file and the repo as its working
# directory — and an MCP client inherits almost no environment, so none of that
# can be assumed. A client that spawns `node` directly gets "cannot find module"
# or a silent failure to read .env.local, and the only symptom is a connector
# that never lists any tools.
#
# Config for Cursor / LM Studio / Claude Desktop (~/.cursor/mcp.json etc.):
#   { "mcpServers": { "ber-wilson-crm": {
#       "command": "/Users/richardwhite/berwilson-platform/scripts/mcp-stdio.sh" } } }
#
# ⚠ Stdout is the protocol channel. Nothing may print to it but the server
# itself, which is why this script redirects nothing and adds no banner.
set -eu
REPO="${0:A:h:h}"
cd "$REPO"
export PATH="$HOME/.node/bin:$PATH"
exec node \
  --experimental-strip-types \
  --no-warnings \
  --import ./deploy/register.mjs \
  --env-file=.env.local \
  scripts/mcp-stdio.mts
