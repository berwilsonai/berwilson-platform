# Deploying to the Mac Studio (self-hosted, Tailscale-only)

Step 1 of the full-local migration (see CLAUDE.md §12, 2026-07-06): the platform
runs on the Mac Studio (`100.86.79.4`), reachable **only inside the tailnet** —
no public exposure. Vercel keeps running in parallel until cutover.

## One-time prerequisites (on the Studio)

- Node.js: `brew install node`
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

## Known caveats

- **Microsoft OAuth (calendar / email research):** the Azure app registration's
  redirect URIs include only the Vercel domain. Before connecting the mailbox
  from the Studio origin, add the Studio URL's callback
  (`https://<studio-host>/api/email/oauth/callback`) in the Azure portal.
- **Embeddings still Gemini** (`EMBEDDINGS_PROVIDER=gemini`) until the step-3
  re-embed — do not flip it on the Studio env by hand.
- Supabase is still cloud-hosted (step 4 pending).
