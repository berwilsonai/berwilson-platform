#!/usr/bin/env zsh
#
# Regenerate src/types/database.ts from the SELF-HOSTED Postgres.
#
# ⚠ THIS REPLACED A STUB THAT HAD BEEN DISABLED SINCE THE CUTOVER. The original
# `npm run gen-types` ran `supabase gen types --linked`, which points at the
# retired cloud project (qauclkrdejgtpywqixho) rather than the Studio's own
# database — so regenerating produced the WRONG schema, and the response was to
# disable it. The generated types then froze, 32 tables accumulated outside
# them, and six modules grew hand-maintained row interfaces to compensate.
#
# ⚠ THE ONLY REASON IT LOOKED UNFIXABLE IS `sslmode`. supabase-db publishes
# 5432 on localhost and does not speak TLS, and the CLI defaults to requiring
# it: the failure is `tls error (The server does not support SSL connections)`,
# which reads like a connection problem rather than one query-string parameter.
#
# Usage:  npm run gen-types
#
# SUPABASE_DB_URL overrides the connection; with it unset the password is read
# out of the running container, so the common case needs no configuration.

set -e
cd "$(dirname "$0")/.."

TARGET=src/types/database.ts

# ── The concurrent-session guard ─────────────────────────────────────────────
# CLAUDE.md §12: this file is hand-maintained and TWO Claude sessions share the
# repo, so both have added columns to it independently. A regeneration is a
# whole-file overwrite; running one over another session's uncommitted edits
# destroys them with nothing to recover from. Commit or stash first.
# --force is for the legitimate case: you just applied a migration and are
# regenerating twice in one sitting, so the pending diff is your own.
if [[ "${1:-}" != "--force" ]]; then
  if ! git diff --quiet -- "$TARGET" || ! git diff --cached --quiet -- "$TARGET"; then
    print -u2 "✗ $TARGET has uncommitted changes."
    print -u2 "  A regeneration overwrites the whole file. Commit or stash them first"
    print -u2 "  — they may belong to the other session (CLAUDE.md §12)."
    print -u2 "  If the pending diff is your own: npm run gen-types -- --force"
    exit 1
  fi
fi

# ── Resolve the connection ───────────────────────────────────────────────────
DB_URL="${SUPABASE_DB_URL:-}"
if [[ -z "$DB_URL" ]]; then
  PW=$(docker exec supabase-db printenv POSTGRES_PASSWORD 2>/dev/null) || {
    print -u2 "✗ supabase-db is not running and SUPABASE_DB_URL is unset."
    print -u2 "  Start Colima + the Supabase stack, or export SUPABASE_DB_URL."
    exit 1
  }
  DB_URL="postgresql://postgres:${PW}@127.0.0.1:5432/postgres"
fi
# The container has no TLS. Without this the CLI fails in a way that reads as
# unreachable rather than as one missing parameter.
[[ "$DB_URL" == *sslmode=* ]] || DB_URL="${DB_URL}?sslmode=disable"

# ── Generate ─────────────────────────────────────────────────────────────────
TMP=$(mktemp -t bw-gentypes)
trap "rm -f '$TMP'" EXIT

print "Generating from the self-hosted database…"
npx --yes supabase@2 gen types typescript --db-url "$DB_URL" --schema public \
  2>/dev/null > "$TMP"

# ── Assert it is the RIGHT database, not merely a reachable one ──────────────
# A cloud project would answer this call perfectly and produce a plausible file.
# project_spvs post-dates the cutover by two years, so only the Studio has it.
if ! grep -q '"project_spvs"' "$TMP"; then
  print -u2 "✗ Generated schema has no project_spvs — that is not this database."
  exit 1
fi

# ── Assert COVERAGE, with the reason beside the number ──────────────────────
LIVE=$(docker exec supabase-db psql -U postgres -tAc \
  "select count(*) from information_schema.tables
   where table_schema='public' and table_type='BASE TABLE'" 2>/dev/null | tr -d ' ')
# Count the table types the way that is actually robust against the CLI's
# indentation: a table is the quoted key immediately above its own `Row:`.
GOT=$(grep -B1 'Row: {' "$TMP" | grep -oE '"[a-z_0-9]+": \{' | sort -u | wc -l | tr -d ' ')
if [[ -n "$LIVE" && "$GOT" -lt "$LIVE" ]]; then
  print -u2 "✗ Generated $GOT table types against $LIVE live tables."
  exit 1
fi

mv "$TMP" "$TARGET"
trap - EXIT
print "✓ $TARGET regenerated — $GOT table types, $LIVE live tables."
print "  Now run: export PATH=\"\$HOME/.node/bin:\$PATH\" && npx tsc --noEmit"
