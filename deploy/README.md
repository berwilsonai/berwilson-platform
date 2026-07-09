# Deploying to the Mac Studio (self-hosted, Tailscale-only)

Step 1 of the full-local migration (see CLAUDE.md §12, 2026-07-06): the platform
runs on the Mac Studio (`100.86.79.4`), reachable **only inside the tailnet** —
no public exposure. Vercel keeps running in parallel until cutover.

## One-time prerequisites (on the Studio)

- Node.js (no sudo/Homebrew needed — installed 2026-07-07 this way):
  `mkdir -p ~/.node && curl -fsSL https://nodejs.org/dist/v26.0.0/node-v26.0.0-darwin-arm64.tar.gz | tar -xz -C ~/.node --strip-components=1`
- LM Studio running with the server enabled (port 1234) and set to launch at login
- Tailscale running and logged in
- System Settings → Energy → **Prevent automatic sleeping** ON
- Enable **auto-login** (System Settings → Users & Groups) so LaunchAgents start after a reboot
- Remote Login (SSH) enabled, MacBook key authorized (`ssh-copy-id richardwhite@100.86.79.4`)

## Deploy / redeploy

From the repo root on the MacBook:

```
zsh deploy/deploy-to-studio.sh
```

Idempotent: rsyncs the source, regenerates the Studio `.env.local` from the
MacBook one (LM Studio URL flipped to localhost, Vercel-only vars dropped,
CRON_SECRET generated if absent), builds, (re)installs the launchd services,
and enables `tailscale serve`.

## Offline basemap for /map (one-time)

The interactive project map serves its own map tiles — nothing loads from the
internet at view time. The archive lives at `~/berwilson-data/maps/us.pmtiles`
(outside the app dir, so the deploy `rsync --delete` never touches it) and is
streamed by `/api/map/tiles` (range requests; path override `MAP_PMTILES_PATH`).
Until it exists, `/map` shows a "basemap not installed" notice.

- **MacBook (local dev):** `zsh scripts/setup-map-data.sh` — extracts a small
  Utah cut (~275MB) and vendors fonts/sprites into `public/basemaps/`
  (gitignored; the deploy rsync ships them with the source).
- **Studio (production):** the full-depth continental-US extract (~17–20GB,
  ~1h) runs directly on the Studio — done 2026-07-09:
  `ssh` in, then `~/.local/bin/pmtiles extract https://build.protomaps.com/<yyyymmdd>.pmtiles ~/berwilson-data/maps/us-conus.pmtiles --bbox=-125.5,24.0,-66.5,49.6`,
  verify with `pmtiles show`, then `mv` it over `us.pmtiles`. (go-pmtiles
  binary is at `~/.local/bin/pmtiles` on the Studio.)
- The deploy script pushes the MacBook archive to the Studio **only if the
  Studio has none**, and never overwrites an existing Studio archive — so the
  big CONUS extract can't be clobbered by the small dev one. Upgrading the
  basemap later (new planet build) is a manual re-extract on the Studio.

## What runs on the Studio

| launchd label | What | Schedule |
|---|---|---|
| `com.berwilson.platform` | `next start` on port 3000 | always (KeepAlive) |
| `com.berwilson.cron-daily-brief` | POSTs the daily-brief cron route | 6:30am local |
| `com.berwilson.cron-risk-scores` | POSTs the risk-scores cron route | 1:00am local |

Logs: `~/Library/Logs/berwilson/` on the Studio.

## Access

- Inside the tailnet: `https://richards-mac-studio.<tailnet>.ts.net` (via
  `tailscale serve`) or `http://100.86.79.4:3000`.
- Phones/laptops need the Tailscale app logged into the same tailnet.

## Self-hosted Supabase (CUTOVER DONE 2026-07-07 — this IS production)

Lives on the Studio at `~/supabase-selfhost/` (NOT in this repo): official
docker compose trimmed to 8 services (`docker/docker-compose.lean.yml` —
realtime/functions/pooler dropped; the app uses none of them), running under
**Colima** (`~/.local/bin`, no sudo). Secrets + signed ANON/SERVICE_ROLE JWTs
in `docker/.env` (mode 600). Postgres 17.6 = exact cloud match.

- Manage: `ssh studio` then `cd ~/supabase-selfhost/docker && docker compose -f docker-compose.lean.yml <ps|logs|restart>`
- Dashboard: `http://localhost:8000` on the Studio (basic auth; creds in `docker/.env`)
- **Backups: nightly 2:30am** (`com.berwilson.backup` → `~/supabase-selfhost/backup.sh`):
  `pg_dumpall` + storage tarball to `~/Backups/berwilson/`, 14-day retention.
  **Offsite copy still pending** — needs SSH enabled on the Mac mini (or another target).
- Colima autostarts at login (`com.berwilson.colima`); containers are `restart: unless-stopped`.
- Trial migration 2026-07-07 verified: all row counts match, 56/56 storage files,
  auth/REST/storage/match_chunks all answering locally. Cloud DB password was
  reset via the Management API (app unaffected — it uses API keys); the new one
  is in `~/supabase-selfhost/.cloud-db-password` on the Studio.

### Cutover runbook (EXECUTED 2026-07-07 — kept for reference / disaster recovery)
1. Freeze writes (stop using the Vercel app; pause Vercel crons).
2. Re-run the dump/restore + file sync (fresh data; ~5 min — scripts in `~/supabase-selfhost/dumps` + `sync/`).
3. Point the Studio app's `.env.local` at local Supabase: `NEXT_PUBLIC_SUPABASE_URL=https://richards-mac-studio.tail0e5306.ts.net:8443` (browser-reachable; add `tailscale serve --bg --https=8443 http://localhost:8000`), local ANON/SERVICE_ROLE keys; restart `com.berwilson.platform`.
4. Step 3 re-embed: flip `EMBEDDINGS_PROVIDER=local`, wipe + re-embed chunks (backfill endpoint + updates re-embed).
5. Verify logins, tasks, docs, search. Then decommission Vercel + revoke Gemini key + pause cloud Supabase (step 5).

## Known caveats

- **Microsoft OAuth (calendar / email research):** the Azure app registration's
  redirect URIs include only the Vercel domain. Before connecting the mailbox
  from the Studio origin, add the Studio URL's callback
  (`https://<studio-host>/api/email/oauth/callback`) in the Azure portal.
- Embeddings are local (knowledge base re-embedded at cutover; model swap = rerun `deploy/reembed.mjs` via `deploy/alias-loader.mjs`).
- Cloud Supabase project `qauclkrdejgtpywqixho` is PAUSED (restorable rollback); Vercel project deleted — `git push` is backup only, deploys happen via this script.
