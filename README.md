# Ber Wilson — Executive Intelligence Platform

Internal executive intelligence tool. Next.js 16 (App Router) + self-hosted Supabase, running
**entirely local** on the Mac Studio behind Tailscale, with a local LLM (LM Studio / Qwen). No
Vercel, no Supabase cloud — see `CLAUDE.md` for the full architecture and history.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000. Requires a `.env.local` (Supabase URL/keys, `CRON_SECRET`, Microsoft
Graph creds, local-AI vars). See the env section of `CLAUDE.md`.

## Deployment (self-hosted)

The platform runs on the Mac Studio, not a cloud host:

- **App:** `npm run build` + `next start` on :3000, kept alive by the `com.berwilson.platform`
  launchd agent, exposed inside the tailnet via `tailscale serve`.
- **Database + storage:** self-hosted Supabase (Docker) on the same box.
- **Crons:** launchd agents (`com.berwilson.cron-*`) that curl the `/api/cron/*` routes with
  `CRON_SECRET`.
- **Deploy:** `zsh deploy/deploy-to-studio.sh` (rsyncs the repo to the Studio, installs deps,
  builds, reloads the launchd services). See `deploy/README.md`.

## Types

`npm run gen-types` regenerates `src/types/database.ts` from the local Postgres
(`SUPABASE_DB_URL`). Types are also hand-extended when migrations land ahead of a regen.
