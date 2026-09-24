# BER WILSON — Executive Intelligence Platform
# Master Architecture & Build Reference (CLAUDE.md)
# Version: 2.0 | 2026-06-22

---

## WHAT THIS FILE IS

Canonical reference for every Claude Code session working on the Ber Wilson platform. Lives in the project root as `CLAUDE.md`; Claude Code reads it automatically.

**This file is the reference. The session-by-session history lives in [`docs/BUILD-LOG.md`](docs/BUILD-LOG.md)** — split out 2026-09-23, when this file hit 606k characters against a 150k limit above which it is silently truncated. §12 keeps the durable rules distilled out of that log; §13 keeps current status and open items.

**Builder:** Richard (EVP, Ber Wilson) — builds in Claude Code terminal. Not a developer.
**Golden rule:** Never introduce complexity without demonstrated need. Every decision reversible or portable.

> **Version 2.0 note:** This file was rewritten on 2026-06-22 to match the code as it actually is. The v1.0 reference described a Claude-Haiku/Sonnet app that no longer exists. (That rewrite named Gemini as the runtime AI; since the 2026-07-07 cutover it is **local Qwen via LM Studio** — see §2, which is authoritative.) If anything below disagrees with the code, the code wins; fix this file.

---

## HOW TO DEPLOY TO PRODUCTION (read this when Richard says "deploy" / "ship it" / "make it live")

**This exact folder — `/Users/richardwhite/berwilson-platform` on the Mac Studio — IS production AND the git repo.** Editing here + the three steps below is a full deploy. There is no separate server. (Set up 2026-08-25: Richard works directly on the Studio; the old MacBook→Studio rsync flow and the stale `~/Documents/berwilson-platform-main` copy are both retired/deleted.)

When Richard asks to deploy, run these from `/Users/richardwhite/berwilson-platform`:
```bash
git add -A && git commit -m "<what changed>"          # save + version
git push origin main                                   # back up to GitHub (berwilsonai/berwilson-platform, public)
export PATH="$HOME/.node/bin:$PATH" && npm run build   # build (PATH must include ~/.node/bin)
launchctl kickstart -k gui/$(id -u)/com.berwilson.platform   # restart the live app (launchd keeps it on :3000, tailnet-only)
zsh deploy/tailnet-setup.sh                            # assert both tailscale serve listeners + env/hostname agreement
```
**Why that last line:** the serve config is Tailscale's state, not ours, and a logout/upgrade/reinstall wipes it. The old assertion lived in `deploy-to-studio.sh`, which was retired when the Studio became the repo — so from then until 2026-09-16 **nothing re-established it on a deploy**. `tailnet-setup.sh` restores both listeners (443→app, 8443→kong), warns if the node key has an expiry set (an expired key silently drops the platform off the tailnet), and fails loudly if `NEXT_PUBLIC_SUPABASE_URL`/`APP_URL` no longer match the live hostname. **Changing tailnet changes the MagicDNS suffix, and `NEXT_PUBLIC_*` is baked in at BUILD time — so a tailnet move needs `--fix` then a full rebuild, never just a restart.**
Then confirm: `git log --oneline -1` and check the app responds. If `npm run build` fails, do NOT kickstart — the old build stays live; fix the error first. Always `git pull --ff-only` before starting a fresh editing session. Full host/infra detail lives in the `self-hosted-mac-studio-deployment` memory.

---

## 1. PROJECT IDENTITY

**Company:** Ber Wilson — vertically integrated construction, development, and USA prefab steel manufacturing. Salt Lake City, UT.
**Website:** berwilson.com
**Platform:** Internal executive intelligence tool for two executives managing a multi-sector construction pipeline (government contracting, infrastructure, real estate development, prefab manufacturing, institutional).
**Core problem:** Two people managing billions in pipeline across federal bids, PE negotiations, JV structures, subcontractor relationships, and manufacturing coordination. They need a single AI-powered source of truth that thinks like a construction COO.

**Where it's headed:** The near-term job is a clean CRM — track projects, tasks, people, and the company itself so the executive team can steer from a high level. The long-term job is an intelligence layer: load an emailed opportunity (text or RFP docs) into "Ber AI," have it assess the opportunity against Ber Wilson's capabilities and appetite, and recommend whether to pursue and spin up a project. The proposal-intake flow (§6) is the first working slice of that.

---

## 2. TECH STACK

| Layer | Technology | Notes |
|-------|-----------|-------|
| Database + Auth | **Self-hosted Supabase** (Postgres, Auth, Storage) on the Mac Studio | Docker (Colima) lean stack, tailnet-only at `:8443`. RLS enabled on every table (but see §8 — app traffic uses the service role). pgvector enabled. Cloud project paused as rollback safety net. |
| Frontend | Next.js 16 (App Router, TypeScript) | Server components default. Client only for interactivity. |
| Styling | Tailwind CSS v4 + shadcn/ui (`@base-ui/react`) | No custom CSS unless unavoidable. |
| Runtime AI | **Local Qwen via LM Studio** (`src/lib/ai/local.ts`) | All runtime AI. Gemini path dormant behind `AI_PROVIDER` flag (web research only). See §5 + AI Model Rules below. |
| Microsoft Graph | Microsoft Graph API (OAuth) | Powers `/calendar` meeting prep, party enrichment, and **on-demand Email Research** (`/email-research` — human-triggered `$search` over the connected mailbox, human-confirmed intake). The automatic email-to-task scraper was removed 2026-06-25 and stays removed. |
| Vector Search | pgvector inside Supabase Postgres | `text-embedding-qwen3-embedding-0.6b`, 768-dim (truncated + renormalized). |
| File Storage | Supabase Storage (`documents` bucket) | Organized by project / entity / site ID. |
| Deployment | **Mac Studio, tailnet-only** (launchd + `tailscale serve`) | `zsh deploy/deploy-to-studio.sh` from the MacBook. Vercel deleted 2026-07-07; `git push` = GitHub backup only. Crons are launchd agents on the Studio. |

### AI Model Rules (CURRENT — FULLY LOCAL since 2026-07-07)

**The platform is fully self-hosted and fully local-AI as of the 2026-07-07 cutover** (Richard's decision: absolute security, nothing leaves his hardware). Production = the Mac Studio, tailnet-only: app at `https://richards-mac-studio.tail9acc02.ts.net/`, self-hosted Supabase at `:8443`, LM Studio on localhost:1234. **(The MagicDNS suffix changed `tail0e5306` → `tail9acc02` on 2026-09-16 when the tailnet moved to the berwilson.com Workspace org; the Studio is now `100.102.45.39`. Dated entries below still name the old values — that is history, not current state.)**

- **All runtime AI** → `qwen/qwen3.6-35b-a3b` via LM Studio's OpenAI-compatible API (`AI_PROVIDER=local`, `src/lib/ai/local.ts`). Expect ~30–60s on extraction-class tasks (reasoning-heavy model, ~75 tok/s generation).
- **Embeddings** → `text-embedding-qwen3-embedding-0.6b`, truncated+renormalized to 768 dims (schema unchanged). The whole knowledge base was re-embedded locally at cutover (213 chunks). **Never mix embedding models** — a model change means wipe + re-embed (`deploy/reembed.mjs`).
- **PDFs** → local text extraction via `unpdf` (no model call for transcription); images need a vision model loaded in LM Studio.
- **Web research / enrichment** (`research.ts`) → blocked in local mode unless `LOCAL_ALLOW_WEB_RESEARCH=true` (uses Gemini + Google Search; only the query leaves, never platform data). Currently ON — Richard kept the Gemini key for the Enrich Profile buttons on contacts/vendors (verified live 2026-07-07).
- The Gemini path in `gemini.ts` still exists behind the flag but is dormant; cloud Supabase project `qauclkrdejgtpywqixho` is **paused** (restorable safety net); the Vercel project is **deleted**. Every AI call still logs to `ai_queries`.

Anthropic Claude is not used at runtime (removed 2026-06-22).

**Dormant Gemini-path reference (pre-cutover roles; today only web research touches Gemini):**

- **`gemini-2.5-flash`** → Extraction, classification, document/cert summarization, synthesis, briefs, enrichment, research. The workhorse. Routed through `callGemini` / `callGeminiWithFile` in `src/lib/ai/gemini.ts`.
- **`gemini-2.5-pro`** → The construction-executive agent's main reasoning loop (`src/lib/ai/agent.ts`).
- **`gemini-embedding-001`** (768-dim) → Embeddings for RAG (`src/lib/ai/embeddings.ts`, direct v1beta REST call).
- **Web research** → Gemini with Google Search grounding (`src/lib/ai/research.ts`). Perplexity was the original plan and was never adopted; the file header comment still references it — ignore that.
- **Opus / any Claude model** → not used here. (Claude Code, the dev tool, is separate from the app's runtime AI.)

Every AI call logs to the `ai_queries` table (user, prompt, response, model, tokens, latency) — keep that contract when adding calls.

---

## 3. PROJECT STRUCTURE (actual)

The app has grown well beyond the original Phase-1/2 plan. High-level map of what exists today:

```
src/
├── app/
│   ├── dashboard/            # Portfolio overview (health, alerts, daily brief, needs-attention)
│   ├── attention/            # Cross-portfolio "what needs me" list
│   ├── projects/             # List (pipeline + program views) + detail tabs:
│   │   └── [id]/             #   overview, players, updates, documents, milestones,
│   │                         #   financing, diligence, entities, tasks, edit
│   ├── tasks/                # All-tasks view across projects
│   ├── timeline/             # Gantt-style timeline
│   ├── capacity/             # Capacity board
│   ├── investors/            # Capital raise pipeline (investors + investments vs parent co / project SPVs)
│   ├── proposals/intake/     # AI proposal intake wizard (RFP → assessment → create project)
│   ├── intel/                # AI query/agent surface (hybrid retrieval + agent chat)
│   ├── calendar/             # Calendar + meeting prep
│   ├── contacts/             # Global rolodex (parties) + detail
│   ├── vendors/              # Vendors & contractors (entities) + detail, federal scorecards
│   ├── company/              # Ber Wilson company profile (capabilities, certs) — UNDERBUILT
│   ├── review/               # Review queue for low-confidence AI items
│   ├── email-log/            # Ingested-email log
│   ├── activity/             # Append-only audit log
│   ├── login/, auth/         # Auth
│   └── api/                  # ~85 route handlers (see below)
├── components/               # Feature-grouped UI (projects/, dashboard/, contacts/, vendors/,
│                             #   intel/, agent/, review/, opportunities/, layout/, ui/, shared/)
├── lib/
│   ├── ai/                   # gemini.ts, agent.ts, agent-tools.ts, embeddings.ts, research.ts,
│   │                         #   proposal-matching.ts, prompts/*
│   ├── email/                # pipeline.ts, participants.ts
│   ├── integrations/         # microsoft-graph.ts, graph-search.ts, types.ts
│   ├── supabase/             # client.ts, server.ts (RLS), admin.ts (service role), types.ts
│   ├── risk-scoring.ts, rate-limit.ts
│   └── utils/                # constants, sectors, stages, activity
├── hooks/                    # use-stored-state
└── types/                    # database.ts (GENERATED — source of truth), domain.ts
```

**API routes** live under `src/app/api/`. Major groups: `ai/*` (extract, classify, synthesize, brief, draft, agent, research, meeting-prep), `proposals/*` (intake, confirm, upload-chunk), `documents/*`, `projects/*`, `parties/*`, `entities/*`, `email/*`, `cron/*`, plus per-resource CRUD.

---

## 4. DATABASE SCHEMA

**Source of truth is `src/types/database.ts` (generated).** Run `npm run gen-types` after every migration. The schema has expanded far past the original core tables; do not trust a hand-maintained list — read the generated types.

Migrations live in `supabase/migrations/` (41 as of this writing, numbered chronologically).

### Conventions (unchanged)
- All PKs: `id uuid default gen_random_uuid() primary key`.
- All timestamps: `timestamptz default now()`, UTC.
- RLS enabled on every table.
- `activity_log` is append-only — no UPDATE/DELETE policies, ever.
- `updated_at` auto-maintained by trigger; tracked tables auto-insert into `activity_log` via trigger.

### Table groups (read database.ts for columns)
- **Core CRM:** `projects` (with `parent_project_id` hierarchy, `bid_due_date`, `win_probability`, capture fields), `project_players`, `milestones`, `updates`, `documents`, `dd_items`, `financing_structures`, `compliance_items`, `project_dependencies`.
- **Tasks (2026-06-25):** `tasks` (real task model — title/what/why/how/assignee_id/project_id/due_date/status/completed_at), `task_notes` (per-task notes feed), `team_members` (assignee list, seeded Richard/Eric). Replaces the old `updates.action_items` JSON for the task UI.
- **Shared children (2026-09-23):** `project_players`, `milestones`, `dd_items`, `financing_structures`, `entity_projects`, `compliance_items` and `research_artifacts` hang off **either** a project or an opportunity — nullable `project_id` + nullable `opportunity_id`, with a check constraint (exactly-one for the first five, at-most-one for the last two). `milestones.stage` is plain **text**, not the `project_stage` enum, so one table carries both pipelines. Never assume `project_id` is set on these.
- **Directory:** `parties` (people + orgs via `is_organization`), `contact_aliases`, `entities` (legal entities/vendors), `entity_projects`, `party_entities`, `certifications`.
- **Capital raise (2026-07-10):** `investors` (relationship pipeline, links to `parties`), `investments` (investor × target: parent company or project, optional `spv_entity_id` → `entities`), `investor_notes`.
- **Steel CRM (2026-07-25):** `steel_deals` (prefab steel deal pipeline: quote→engineering→order_placed→delivered→paid, lead source, salesperson FK→team_members, sqft/$SF/value), `steel_deal_notes`. Own role `steel_sales` sees only this module.
- **Dino (2026-07-28):** internal operating company (acquired plumbing/HVAC co, dinoservicepros.com — NOT a vendor). `dino_revenue` (source_type internal|external; internal → FK project_id, external → client_name; per-job or periodic lump), `dino_payments` (the $150k/12-mo obligation schedule), `dino_notes`. Tracks the internal-vs-external revenue split (show Dino its revenue increasingly comes from Ber Wilson) + money we owe them. Admin-only. See build-status.
- **Company:** `company_profile`, `media`.
- **AI / intelligence:** `ai_queries`, `chunks` (pgvector), `agent_conversations`, `agent_messages`, `research_artifacts`, `review_queue`, `risk_scores`, `proposal_intake_sessions`, `stored_briefs`, `portfolio_briefs`.
- **Microsoft Graph:** `email_tokens` (OAuth — calendar/enrichment/email research).
- **Audit:** `activity_log` (append-only).
- **RPCs:** `match_chunks`, `match_parties_by_name`, `match_projects_by_name`.

---

## 5. AI ARCHITECTURE

### Unified Gemini client — `src/lib/ai/gemini.ts`
- `callGemini({ task, systemPrompt, userMessage, userId, promptVersion?, maxTokens?, jsonMode? })` — text in, text/JSON out. `jsonMode` defaults true (uses `responseMimeType: application/json` + strips stray code fences).
- `callGeminiWithFile({ systemPrompt, prompt, file: { mimeType, dataBase64 }, userId, logLabel?, promptVersion?, maxTokens?, jsonMode? })` — multimodal: a PDF/image plus a text instruction. Used by document and certification summarization.
- Both return `{ data, model, tokensIn, tokensOut, latencyMs }` and log to `ai_queries` (fire-and-forget). When the model returns valid JSON, `data` is the parsed object; otherwise `data` is the raw string — callers should branch on `typeof data === 'object'`.

### Extraction shape
Extraction prompts return structured JSON (summary, action_items, waiting_on, risks, decisions, mentioned_parties, mentioned_projects, confidence). See `src/lib/ai/prompts/extraction.ts`.

### Agent — `src/lib/ai/agent.ts` + `agent-tools.ts`
`gemini-2.5-pro` agentic loop (up to 5 tool-call rounds). Injects the Ber Wilson company profile into context so the agent knows the company's qualifications without a tool call. Tools are declared in `agent-tools.ts` and executed via `executeToolCall`. Conversations persist to `agent_conversations` / `agent_messages`.

**Construction Executive Agent persona:** senior EVP/COO, 25+ yrs government contracting, large-scale development, design-build GC, prefab, construction finance. An owner-operator, not a consultant. Four lenses on every recommendation: **Commercial** (can we win it?), **Operational** (can we deliver it?), **Financial** (can we get paid, at what margin?), **Compliance** (can we protect the downside?). Response protocol: Situation → Risks → Recommendation → Next Decision. Never ungrounded guesses; never hide risk; never substitute for legal/tax counsel; always distinguish facts, estimates, and judgments.

### Hybrid retrieval (RAG)
Query → SQL filter → vector search (`match_chunks` RPC over `chunks.embedding`) → re-rank (recency/confidence/cosine) → top chunks into context → grounded answer with citations → log to `ai_queries`.

### Proposal matching — `src/lib/ai/proposal-matching.ts`
Dedupes an inbound opportunity against existing `projects`/`parties` (solicitation #, trigram name, location, client). Does NOT judge fit — that's `fit-assessment.ts`.

### Company context + fit assessment — `src/lib/ai/company-context.ts`, `fit-assessment.ts`
- `getCompanyContext()` builds one prompt-ready markdown block from `company_profile` + active certs (identity, capabilities, bonding, **pursuit profile**: target sectors, project-size range, geographies, delivery/contract vehicles, differentiators, disqualifiers, past performance). Single source of truth — the agent and fit assessment both use it, so they judge against the same picture. Returns `hasPursuitProfile` so callers know when the profile is too thin to judge confidently.
- `assessFit(extraction, userId)` scores an opportunity against that context (Commercial/Operational/Financial/Compliance lenses) and returns `{recommendation: pursue|consider|pass, fit_score, summary, strengths, concerns, gaps, key_questions, profile_incomplete}`. Wired into `api/proposals/intake` (non-fatal) and surfaced as a card in `ProposalIntakeWizard`. **Quality scales with how completely the pursuit profile is filled in on `/company`.**

---

## 6. PROPOSAL INTAKE (the intelligence on-ramp)

Already built, end to end:
1. `/proposals/intake` — `ProposalIntakeWizard` uploads RFP text/docs (chunked upload via `api/proposals/upload-chunk`).
2. `api/proposals/intake` — runs extraction + `proposal-matching` against the company profile, produces an assessment and a proposed set of projects/parties/entities.
3. `api/proposals/confirm` — on approval, creates the projects, contacts, and entities in one transaction.

This is the spine of the "email an opportunity → Ber AI assesses → you decide → project created" loop. As of 2026-06-22 the intake also runs a **fit assessment** (§5) — a pursue/consider/pass recommendation scored against the company pursuit profile, shown at the top of the review step. The remaining work is **data, not plumbing**: fill in the pursuit profile on `/company` (target sectors, size range, geographies, delivery/contract vehicles, differentiators, disqualifiers). Until then the assessment self-flags as low-confidence (`profile_incomplete`).

---

## 7. CONVENTIONS

### Code
- TypeScript strict mode. **Zero `any` escapes as of 2026-07-12** (was ~115 → ~23 → 0); don't add any back. Jsonb inserts use `as unknown as Json`; enum filters cast to `Database['public']['Enums'][…]`; polymorphic JSX wrappers use `ElementType`.
- Server components default; `'use client'` only when interactive.
- All DB access via Supabase clients — no raw SQL in components.
- API routes handle AI + mutations; pages fetch via server components.
- Error boundary + `loading.tsx` on every route.

### Naming
- Database: `snake_case`. TypeScript: `camelCase` vars/functions, `PascalCase` types/components.
- Files: `kebab-case` (non-components), `PascalCase` (components). API paths: `kebab-case`.

### Environment variables
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AI_PROVIDER=local                # all runtime AI via LM Studio (unset = Gemini path, dormant)
LOCAL_AI_BASE_URL=               # LM Studio OpenAI-compatible endpoint
LOCAL_AI_MODEL=                  # must match LM Studio's model identifier
LOCAL_EMBEDDING_MODEL=
EMBEDDINGS_PROVIDER=             # defaults to AI_PROVIDER; NEVER flip without re-embedding (§2)
LOCAL_ALLOW_WEB_RESEARCH=        # true = Enrich Profile web research via Gemini (query-only leaves)
GEMINI_API_KEY=                  # only used for web research when the flag above is true
# ── Google Workspace credentials. getAccessToken() picks a MODE by which of
# ── these are set, so the valid set is mode-dependent — never assert one
# ── specific var in a health check (that misfire shipped once already).
#   mode 1: GOOGLE_SERVICE_ACCOUNT_KEY / _KEY_FILE   — blocked by org policy here
#   mode 2: GOOGLE_SERVICE_ACCOUNT_EMAIL + IAM signJwt — works, unused (needs gcloud)
#   mode 3: per-mailbox OAuth refresh tokens         — IN USE
GOOGLE_SERVICE_ACCOUNT_EMAIL=    # set = mode 2 (IAM signJwt, no key downloaded)
GOOGLE_SERVICE_ACCOUNT_KEY=      # set = mode 1 (raw JSON key) — org policy blocks creating these
GOOGLE_SERVICE_ACCOUNT_KEY_FILE= # set = mode 1 (path to the JSON key)
GOOGLE_APPLICATION_CREDENTIALS=  # optional; standard Google fallback for the above
GOOGLE_OAUTH_TOKENS_FILE=        # mode 3 token store (default ~/berwilson-data/google-oauth-tokens.json, mode 600)
GOOGLE_IMPERSONATE_MAILBOXES=    # optional; overrides the deal mailboxes swept (moose@, tuaone@)
GOOGLE_TASK_MAILBOXES=           # optional; whose Google Tasks lists are synced
LEAD_TASK_SYNC=                  # optional; "off" stops writing lead bid deadlines as tasks
LEAD_TASK_OWNER=                 # optional; team member a lead's task is assigned to
WHISPER_BIN=                     # meeting transcription binary (~/whisper.cpp/build/bin/whisper-cli)
WHISPER_MODEL=                   # ggml model path. BOTH are stat'd at runtime — a missing file is a silent outage
AFCONVERT_BIN=                   # optional; audio decoder (default /usr/bin/afconvert)
CRON_SECRET=                     # Bearer auth on cron routes; launchd cron agents on the Studio send it
APP_URL=                         # tailnet base URL for links in outbound notifications (task digest "Open my tasks")
SUPABASE_DB_URL=                 # optional; local Postgres URL for `npm run gen-types` (self-hosted, replaces --linked)
MAP_PMTILES_PATH=                # optional; /map detail basemap archive (default ~/berwilson-data/maps/us.pmtiles)
MAP_WORLD_PMTILES_PATH=          # optional; /map world-overview archive z0-7 (default ~/berwilson-data/maps/world.pmtiles)
CARD_OCR_BIN=                    # optional; business-card OCR binary (Apple Vision). Default ~/.local/bin/bw-ocr — build with `zsh scripts/build-ocr.sh`
BACKUP_DIR=                      # optional; nightly-backup dir the health page checks (default ~/Backups/berwilson)
GOOGLE_LEAD_MAILBOXES=           # mailbox(es) swept for INBOUND LEADS (default info@berwilson.com) — kept apart from the deal mailboxes
GMAIL_LEAD_EXCLUSIONS=           # optional; overrides the LEAD sweep's Gmail-side marketing filter (default: -category:promotions -category:social -label:bw-filtered)
GMAIL_DEAL_EXCLUSIONS=           # optional; the same filter for the DEAL sweep (moose@/tuaone@), added 2026-09-22. Same default. Applying the `bw-filtered` Gmail label to a sender retires them with no code change
LEADS_NOTIFY_EMAIL=              # optional; where scored leads are announced. UNSET = nothing is sent (the queue still fills)
GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID=# optional; COMMA-SEPARATED Drive folder ids indexed nightly into the company KB (nested subfolders included, "Archive" subfolders skipped) so lead fit scores are grounded. UNSET = sync no-ops. Nominating folders IS the control model — never point it at a drive root
GOOGLE_DEAL_INTAKE_FOLDER_ID=  # optional; Drive parent the berwilson.com deal form creates one folder per submission inside. UNSET = deal intake off (cron 503s). Contract: deploy/deal-intake-form.md
GOOGLE_MEET_FOLDER_ID=           # optional; where Meet files recordings/transcripts. UNSET = resolve a "Meet Recordings" folder in each exec's own Drive (Google's default)
DINO_LEAD_EMAIL=                 # optional; where plumbing/HVAC leads are forwarded (Dino has no platform access). UNSET = Forward errors
GOOGLE_CHAT_WEBHOOK_URL=         # optional; Chat space lead digests are ALSO posted to. Carries its own auth token — treat as a secret. UNSET = email only
GOOGLE_CHAT_WEBHOOK_URL_<KEY>=   # optional; a second space, addressed by <KEY> (e.g. STEEL) without touching the notify layer
LEAD_MAILBOX_HYGIENE=            # optional; "off" stops the platform unsubscribing from marketing and spamming junk in info@. Unset = ON. Scoped to the LEAD mailbox only — moose@/tuaone@ are Eric's and Richard's own and hold read-only Gmail scopes anyway
LEAD_GMAIL_LABELS=               # optional; "off" stops writing the triage verdict back as a Gmail label on info@ threads. Unset = labelling ON
LEAD_DRAFT_REPLIES=              # optional; "off" stops drafting replies to pursue leads. Unset = drafting ON (a draft is never sent)
LEAD_CALENDAR_SYNC=              # optional; "off" stops writing lead bid/site-visit deadlines to Google Calendar. Unset = sync ON
STEEL_QUOTES_FOLDER_ID=          # optional; the team's own Drive folder generated quote PDFs are filed into (Prefab Steel Projects / Utah / Quotes folder). UNSET = quotes stay in the platform's own deal folder. Writing here works under drive.file because it is a SHARED DRIVE folder moose@ can add children to — see google-drive.ts
```
**The MICROSOFT_* vars are gone** (2026-09-21): zero references in `src/` and none in `.env.local` since the 2026-08-23 move to Google Workspace. `MICROSOFT_SECRET_EXPIRES` was documented as driving a 30-day health warning; the health page never read it.

`ANTHROPIC_API_KEY` and `PERPLEXITY_API_KEY` are no longer used — remove from any new env files. The n8n-era vars (`N8N_*`, `INGESTION_INBOUND_SECRET`) are gone from Vercel (verified 2026-07-03). `NEXT_PUBLIC_SITE_URL` is no longer referenced anywhere (the agent self-fetches that used it were refactored to direct lib calls 2026-07-03).

### Git
- Main branch: `main`. Pushing is GitHub backup only (Vercel deleted 2026-07-07) — **deploying = `zsh deploy/deploy-to-studio.sh`** after pushing.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`. Never commit `.env.local`.

---

## 8. SECURITY / COMPLIANCE

- Middleware (`middleware.ts`) gates every route: unauthenticated users are redirected to `/login`. Public exceptions: login/auth, the risk-scores cron, and the Microsoft OAuth callback.
- **RLS is defense-in-depth, not the active boundary.** App traffic — including ~33 server pages — uses the service-role admin client (`lib/supabase/admin.ts`), which bypasses RLS. The auth boundary is the middleware. This is an accepted trade-off for a 2-user internal tool; if the team grows or sensitive data lands, move pages to the RLS-respecting server client (`lib/supabase/server.ts`).
- `documents.classification` flags standard vs sensitive. All AI calls logged to `ai_queries`.
- US-only infrastructure. **Do not store CUI** until a GovCloud migration is done. GovCloud trigger: annual DoD revenue > $2M OR a contract requiring CMMC L2. Stack is portable by design (standard Postgres, no vendor lock-in).

---

## 9. KNOWN DEBT / AUDIT NOTES (2026-06-22)

Captured so future sessions don't rediscover them:
- ~~Scope sprawl~~ **LARGELY RESOLVED 2026-07-03:** the Equity & Valuation and Portfolio site-hierarchy modules were removed entirely (~13.5K lines across code + generated types), along with background checks, vendor scorecards/reviews, the Procore stub, and dead scraper-era tables/functions. Nav is 15 → 13 destinations. If a CFO joins and needs basic finance tools/reports, build a fresh purpose-built section then — do not resurrect the old modules.
- ~~Overlapping "attention" surfaces~~ **RESOLVED 2026-07-03:** `/attention` folded into Dashboard (Needs Attention panel + sidebar badge on Dashboard), `/capacity` folded into `/tasks` (per-person workload chips); both old routes redirect. `/timeline` left primary nav (linked from the Projects toolbar). One attention engine remains: `/api/attention` (also feeds the agent's `get_attention_items`).
- **Two directory concepts** — **surface consolidated 2026-07-03:** one nav destination (`/contacts` = "Directory" with Contacts | Vendors & Contractors tabs via `?tab=vendors`; the `/vendors` list redirects there, detail/new routes stay). The *data model* is still two tables (`parties` + `entities`); a full data merge into `parties` remains optional future work — only if the split causes real pain.
- ~~Type drift~~ **RESOLVED 2026-07-12:** every stale `as any`/`: any` removed (the generated types had long covered `project_dependencies`/`stored_briefs`); `src` now has zero `any` escapes. Keep it that way (§7).
- ~~Speculative early-build features~~ **RESOLVED 2026-07-03:** Procore stub, background checks, and vendor scorecards/reviews removed. Party/entity enrichment (Gemini research) is real and stays.
- ~~Legacy `action_items`~~ **FULLY RETIRED 2026-07-03.** Reads moved to the `tasks` table earlier (via `src/lib/tasks/queries.ts`); writes stopped 2026-07-03 — manual-paste extraction creates real tasks at save time (`src/lib/tasks/from-action-items.ts`) and review-queue approval converts legacy pending items. `20260704000004_drop_action_items.sql` drops the column (code shipped first; dual-schema safe). The extraction *prompt* still returns `action_items` JSON — that's the contract feeding task creation, not schema debt. Old email-era tables `processed_emails`/`graph_subscriptions` and `updates.outlook_web_link` are dropped by `20260704000001_simplification_drops.sql`.
- **Pre-existing lint noise (recount 2026-07-05, after the lint-debt pass):** two `react-hooks/purity` errors in `src/app/dashboard/page.tsx` (`Date.now()` in a server component — rule misfire, runtime fine); 12 `react-hooks/set-state-in-effect` errors (load-on-mount fetch / localStorage hydration / sync-form-on-modal-open patterns — each needs a per-component rewrite to satisfy the React Compiler; deliberately left, they work; recount 2026-07-12); 6 `@next/next/no-img-element` warnings (Supabase Storage images — switching to `next/image` needs `remotePatterns` config; do it if image cost/LCP ever matters). Everything else was cleaned 2026-07-05 (76 → 21 problems; 20 as of 2026-07-12).
- **`team_members` is a 4th people-concept** (alongside parties/entities/stakeholders), kept tiny for fast task assignment. **Partly reconciled 2026-07-21:** `team_members.party_id` now links a task owner to their `parties` contact (quick-add + meeting owner-promotion both find-or-create the linked contact), so owner and contact are one person. Full table merge still deferred — tasks keep `assignee_id → team_members.id`; do a full merge only if the split causes real pain.

---

## 10. CONTACTS / DIRECTORY (original intent)

`parties` is the global contact directory. People and organizations both live here (`is_organization=true` for firms). A party is global — editing it updates everywhere. Contact detail shows: bio/contact info, every project they're linked to (via `project_players`) with role, updates/documents mentioning them, DD items assigned, compliance items owned. Routes: `/contacts`, `/contacts/[id]`.

Note the drift flagged in §9: `entities`/vendors partly duplicate this. The *surface* is consolidated (one Directory destination, 2026-07-03); when touching directory data code, still prefer consolidating toward `parties`.

---

## 11. DO NOT

- Add a separate vector database (pgvector is fine for years).
- Use LangChain, LlamaIndex, or any AI orchestration framework.
- Build microservices, use Docker/containers, or add Prisma/Drizzle (Supabase client + generated types only).
- Reintroduce a second AI provider SDK — runtime AI is Gemini. (Removing Anthropic was deliberate.)
- Pre-build features for future phases.
- Store CUI until GovCloud migration is complete.
- Never let mail become a record **without human review**. The webhook pipeline removed 2026-06-25 was banned because it *silently turned inbox mail into records*; that prohibition stands and is the invariant to protect.
  - **Amended 2026-08-23 (Richard's explicit direction):** the platform now DOES read both mailboxes automatically on a schedule — `/api/cron/email-sweep` sweeps all of `moose@` and `tuaone@`, summarizes every thread, and groups them into candidate deals. This is a deliberate reversal of the "human triggers each mailbox search" half of the old rule, made to populate the CRM from years of existing correspondence.
  - **What did NOT change:** the sweep only ever stages `pending` sessions. Creating a project, opportunity, party, or task still requires the human confirm step in Email Ingestion. No automatic record creation, ever.
- Reintroduce Microsoft Graph / Outlook. The platform moved to Google Workspace 2026-08-23 (service account + domain-wide delegation, read-only scopes). There are no stored mail tokens and no OAuth flow to maintain.

---

## 12. HARD-WON RULES

Distilled from the build log. Each line is a bug that cost real hours — several of them twice. The full story behind any of them is in `docs/BUILD-LOG.md`; search the date or a keyword.

### Postgres / PostgREST

- **`.or()` takes a LOGIC TREE, not a list of values.** An unescaped comma in a user or model value parses as a condition separator, the query dies, and callers swallow it into "no results". Build every such filter through `orIlike`/`orIlikeAnyWord` (`src/lib/utils/postgrest.ts`). — 09-23
- **Never `::` cast inside a PostgREST filter.** `.or()` rejects the cast outright; a plain `.filter()` silently drops it and hands raw jsonb to the operator. Use `->>` / `->`. — 08-28
- **Adding a second FK to an already-embedded table breaks EVERY existing embed of it** (PGRST201). Hint the constraint name at all call sites — `team_members!tasks_assignee_id_fkey`. `tsc` catches at most one of them. — 07-13
- **`.neq()` is NULL — and therefore not true — for a NULL column**, so a nullable status silently hides rows from every reader that filters on it. Make the column NOT NULL, or handle NULL explicitly. — 09-23
- **`ON CONFLICT` cannot use a partial unique index** — PostgREST has no way to repeat the predicate. Postgres already treats NULLs as distinct, so the predicate is usually unnecessary anyway. — 09-09
- **Adding a discriminator column means checking for a CHECK constraint on it.** A new value typechecks, deploys, then fails at every INSERT. — 09-19
- **A table created by a migration applied as anything but `postgres` gets NO API GRANTS.** The default privileges that grant anon/authenticated/service_role hang off `postgres`, so a table owned by `supabase_admin` silently receives none — every PostgREST call answers `42501`, and `postgres` cannot even grant on it afterwards (`WARNING: no privileges were granted`). Apply migrations as `postgres`; if a feature "does nothing", check `information_schema.role_table_grants` before reading its code. — 09-24
- **`pg_stat_user_tables.n_live_tup` IS A STALE ESTIMATE.** It reported `projects` at 1 against a real 15 and `risk_scores` at 110 against 947. Never let it drive a decision — `count(*)`. — 09-24
- **Never `NULL || array`** on a bucket's `allowed_mime_types`: NULL means unrestricted, and the concat collapses it to just the appended list — silently rejecting every other type platform-wide. — 07-28
- **A multi-row insert is ONE statement with a uniform column list.** Rows that omit a column get an explicit NULL, not the default. — 09-15
- **PostgREST truncates at 1000 rows, silently.** Paginate any select that could exceed it. — 09-22
- **Never string-compare a Drive `modifiedTime` against a stored `timestamptz`** — PostgREST round-trips with an offset (`…Z` vs `…+00:00`), so they are never equal. Compare instants. — 09-05
- **Check what a table CONTAINS, not just how many rows it has, before calling it unused.** — 09-22

### Google Workspace

- **`leads.thread_id` is NOT a Gmail thread id** — it is an FK to `email_threads.id`. Any read that will go on to touch Gmail must carry `email_threads(gmail_thread_id)`. — 08-26
- **Never assert one specific Google env var in a health check.** `getAccessToken()` picks a mode by which vars are set, so the valid set is mode-dependent. Use `isGoogleConfigured()`. — 08-24
- **A content hash cannot detect a change made on the far side of the API.** Something must observe the remote state, or a hand-deleted remote record is never restored. — 08-26
- **Gmail meters by cost-units-per-MINUTE, not per request.** Pace bulk reads (~150–250ms) or even a retrying client exhausts quota. `messages.batchModify` takes 1,000 ids per call. — 09-17
- **The deal mailboxes are read-only by design** (`moose@` / `tuaone@`); only `info@` carries `gmail.modify`. Labelling or trashing there 403s — that is the scope tiering working. — 09-22
- **`drive.file` CAN write into a human-created folder on a SHARED drive** (adding a child is the impersonated user's right, not the app's) but NOT in My Drive. `canDelete` stays false — trash, never delete. — 09-16
- **Any token-file swap needs `launchctl kickstart`** — the OAuth store is cached in module scope. — 08-24
- **Never duplicate the scope list.** The setup script parses `SCOPES` out of the app source for exactly this reason. Adding a scope does nothing to already-minted tokens; they 403 on first use. — 08-25
- **Gmail's own composer stamps a Content-ID on every attached file** — Content-Disposition is authoritative and must be checked FIRST, or every attachment sent from Gmail is discarded as inline chrome. — 09-17

### Next.js / React

- **Helpers shared between server pages and client components live in `src/lib`** — never exported from a `'use client'` file. Every export of a client module becomes a client reference; calling one from a server page throws at REQUEST time, and `tsc`/build do not catch it. — 07-11
- **Never use `request.nextUrl.origin` for user-facing URLs** (OAuth redirect URIs, links). Behind `tailscale serve` the Host header is rewritten to localhost. Use `publicOrigin(request.headers)`. — 07-11
- **Never put an overridable default behind a `data-[…]` variant.** An attribute selector (0,2,0) beats the utility a caller passes in, and twMerge cannot dedupe across a variant prefix. — 08-27
- **`text-wrap: balance` defeats `truncate`** — it sets the same longhand `white-space: nowrap` feeds, and wins on cascade order. — 08-27
- **`accept="audio/*"` alone is NOT sufficient on macOS/iOS** — list the extensions too. — 09-01
- **A union whose arms share a property name cannot be narrowed by that property.** — 09-15
- **Agent tools never fetch the app's own HTTP routes** — extract the shared logic into `src/lib`. — 07-03
- **Never use browser-side `createSignedUrl`** against this stack — storage has no RLS policies, so it cannot work. Mint signed URLs server-side. — 07-08
- **44px is this app's minimum touch target.** Grow it with an `-inset-3` overlay, never with padding, or the row shifts under the next tap. — 08-27
- **`next dev` (Turbopack) does not load the root `middleware.ts`** — every page and API is unauthenticated in local dev. Role and auth behaviour must be tested against `next build` + `next start`. — 07-09

### Studio / infrastructure

- **The Tailscale serve config is Tailscale's state, not ours.** Assert BOTH listeners on every deploy (`zsh deploy/tailnet-setup.sh`). Losing them takes the platform down while every local check still reports healthy. — 09-09
- **Changing tailnet changes the MagicDNS suffix, and `NEXT_PUBLIC_*` is baked in at BUILD time** — a tailnet move needs `--fix` then a full rebuild, never just a restart. — 09-16
- **`next start` loads the build at boot.** A rebuild without `launchctl kickstart` changes nothing — three sweep phases ran only by hand for nine days because of this. — 09-20
- **Check `lms ps` against the documented config before blaming code** for slow or stalled AI; an LM Studio update resets it. The tell is a model id ending `:2`. `parallel` is the costly setting, not context, and `lms unload` takes no `-y` (passing it loads ANOTHER copy). — 09-14
- **Do not run a backfill and a deploy at the same time on this box.** If the app 000s after a kickstart, check free memory and the service's exit code (−9 = OOM-killed) before suspecting Supabase. — 09-14
- **Do NOT edit a shell script while it is running** — zsh reads by byte offset, so the running copy resumes at a garbage position and dies with a syntax error that is not there. — 09-23
- **`supabase db push --linked` targets the WRONG database** (the retired cloud project). Apply migrations by piping SQL to `docker exec supabase-db psql` over ssh; back up any table being dropped first. — 08-23
- **After killing a sweep mid-run, clear `page_token`** or the next cron resumes from that cursor and re-ingests everything. — 09-09
- **A backup is not a backup until it has been read back** — and its filename needs seconds, or a same-minute retry overwrites the good copy. — 09-15
- **LM Studio serves ONE request at a time.** Overlapping crons queue behind each other; that is why the digest is 7:00am and the brief 6:30am. — 09-23

### Design / process

- **A coverage count is the only honest signal for a feature whose failure mode is doing nothing.** A count that has stopped growing is indistinguishable from a quiet inbox — measure AGE instead. — 09-09, 09-20
- **Never fork a shared pass per table — add a target.** The one forked copy of `runDocumentAiPass` silently discarded 413,000 characters. — 09-17
- **A dedupe key derived from a conversation's FIRST message identifies the conversation, not its contents.** Never use one to decide "already seen". — 09-09
- **Measure before building.** Repeatedly the premise was wrong: the Drive was already clean, the local model is 93% idle because it has FINISHED, and three planned passes were built and then REMOVED after measuring them. — 09-22, 09-23
- **`fit_score` carries ±20 points of sampling noise.** Read the pursue/consider/pass verdict, never the number; do not sort or threshold on it. — 08-26
- **Ambiguity must mean NO match.** Two records scoring identically on a name is the case that must refuse, not guess. — 09-09
- **`matchesPrefix` is NOT method-aware** — allowlisting a read path grants every mutation under it. Routes carry their own guards regardless. — 09-22
- **User-initiated mutations on tracked tables use `actorAdminClient()`**, not `createAdminClient()`, or the activity log says "system". — 07-03
- **Task owners and contacts are one person** — `team_members.party_id` ties them; adding or using an owner maintains the contact. — 07-21
- **New UI uses the Panel / Chip / `label-caps` idiom and `.elev-*`, never raw `shadow-*`.** No glassmorphism, no animated numbers, color only for status meaning. Date fields use `DatePicker`, never a native `<input type="date">`. — 07-17, 07-10
- **Two Claude sessions share this repo.** Stage files BY NAME, never `git add -A`, or you absorb the other session's in-flight work. Three recorded occurrences. — 09-23

---

## 13. BUILD STATUS

**Reality:** well beyond the original Phase 1/2 plan. Live and in daily use, **self-hosted on the Mac Studio** (`100.86.79.4`, Tailscale-only) against self-hosted Supabase under Colima, with AI served by LM Studio on the same machine. Vercel is no longer the runtime.

**Working:** projects (CRUD, pipeline/program views, hierarchy, all detail tabs), **interactive project map (/map — offline basemap, illustrated markers, rail corridors, present mode)**, **task handoffs (waiting-on) + printable weekly report (/reports/weekly/print, per-person pages)**, **opportunities**, **investors (capital raise pipeline: relationship stages + per-deal commitments vs parent co / project SPVs; named raises w/ tranche schedules + per-raise dashboards; task tags, Ber AI tools + RAG, attention + daily-brief wiring)**, **objectives steering board (Now/Soon/Possibly + PDF export, wired into tasks/dashboard/brief)**, **steel CRM (/steel — prefab steel deal pipeline w/ its own `steel_sales` role, 2026-07-25; one-click quote generation from a Drive-hosted Google Doc template → PDF on the deal + in Drive, 2026-09-16)**, **dino (/dino — internal operating-company revenue tracker: internal-vs-external split + $150k payment schedule, admin-only, 2026-07-28)**, dashboard (single attention surface, opens with Now objectives), timeline, **team tasks** (per-person workload, project/opportunity/objective tags), **one Directory (Contacts | Vendors tabs) + business-card scanner (photo → on-device OCR → researched contact)**, company profile (thin), review queue, activity log, manual-paste extraction (action items → real tasks), intel (RAG + streaming agent) + **ambient Ask Ber AI dock (⌘J, every page)**, **one Intake destination (`/intake`: Email | Proposal tabs, 2026-07-17)** — proposal intake → assessment → project creation, and Email Intake (in-platform **Gmail** sweep → report → opportunity/project + people + tasks). **Calendar/meeting-prep and mail both run on Google Workspace via per-mailbox OAuth (Microsoft Graph removed 2026-08-23); the email-to-task scraper was removed (see below).** Equity & Portfolio modules removed 2026-07-03 (see below).

**Full history: [`docs/BUILD-LOG.md`](docs/BUILD-LOG.md)** — 119 dated entries, 2026-06-22 → 2026-09-24, carrying the reasoning, the measurements and the verification behind every decision. Not auto-loaded into a session; grep it when you need the "why" (*"why is the digest at 7:00am?"*, *"have we hit this bug before?"*).

### Open items (Richard)

Env vars re-checked against `.env.local` on 2026-09-23. Everything else is **as last reported on its date, not re-verified** — confirm against the live system before acting on it.

| Item | Raised | State |
|---|---|---|
| `GOOGLE_DEAL_INTAKE_FOLDER_ID` unset → deal intake off, its cron 503s | 09-05 | **verified still empty** |
| `DINO_LEAD_EMAIL` unset → the Dino forward button 400s | 08-26 | **verified absent** |
| 27 opportunity documents never indexed (the Englert / Gold mine M&A file) — run `node --experimental-strip-types --import ./deploy/register.mjs --env-file=.env.local scripts/reindex-opportunity-documents.mts` | 09-22 | as reported |
| 4 staged intake sessions cannot be accepted until a name is typed — *LOI*, *Text*, *Due Diligence Letter*, *Energy Development Group* | 09-23 | as reported |
| iOS caches home-screen icons hard — remove the shortcut and re-add from Safari to pick up the new logo | 09-23 | as reported |
| Commitment backlog (~1000 threads) drains over a day or two through the hourly sweep; the health card stays amber until it does — the test is whether the number FALLS | 09-23 | self-resolving |
| One team member has no Google Tasks mailbox configured | 09-23 | as reported |
| `deploy/backup.sh` and `~/supabase-selfhost/backup.sh` are synced BY HAND — copy across after editing either | 09-23 | standing |
| 3 senders could not be auto-unsubscribed (officedepot, jooble, mccleerycompany); 5 professional bodies were spammed but deliberately not unsubscribed | 09-22 | optional |
| One test message remains in `moose@` ("Ber Intelligence self-loop verification") — the platform cannot delete it, by design | 09-22 | cosmetic |
| **Sign in as `moose@berwilson.com`, not `info@`** — info@ is now the "Pepper Potts" seat for a future executive assistant, so logging in there greets you as her with an empty task list. Both remain working admin logins; nothing was deactivated. `/settings/users` parks the seat in one toggle when you want it held | 09-24 | **action** |

`GOOGLE_CHAT_WEBHOOK_URL` is now **set**, so the 09-23 manual step is done — but if you created a dedicated "Ber Wilson Updates" space, confirm it points there rather than at the old room.

### Highest-leverage next work

1. **Refine the pursuit profile** on `/company` — a first draft was written 2026-07-03; still missing confirmed delivery methods / contract vehicles, the project size range (min / sweet spot / max), disqualifiers, and past performance. Those four gaps are what stands between "usable" and "sharp" fit assessments.
2. Optionally persist `fit_assessment` on `proposal_intake_sessions` (currently returned in the intake response but not stored).
3. Tend the known debt in §9 as it gets in the way.

### Recent sessions

Newest first; full entries in `docs/BUILD-LOG.md`.

- **09-24** — simplification pass: a table with no grants, a bell with no audience, three dashboard panels that could never show anything
- **09-23** — daily email digest to Google Chat, plus a `commitments` ledger read out of mail (DEPLOYED + MIGRATED)
- **09-23** — the new logo across app chrome, home screen, favicon and PWA
- **09-23** — debug pass: a comma broke six searches, a tool throw killed the agent turn, the offsite backup had been failing for a week
- **09-23** — dev notes: anyone can report a bug from the page it happened on
- **09-23** — opportunities carry the same child records as projects
- **09-23** — `/decide` can be finished from the queue (0 of 193 items were actionable in place, now 189)
- **09-22** — info@ inbox 8,045 threads → 189; unsubscribed from 26 senders
- **09-22** — junk stops at the Gmail edge; only LIVE records receive mail and documents; notifications reach Chat
- **09-22** — simplification pass: the queue had no drain, the router asked twice, nine date formatters
- **09-21** — every project linked to a Drive folder; aliases set from evidence
- **09-21** — documents file themselves into the team's own Drive subfolders
- **09-20** — the sweep's last three phases had never run; retrieval could not scope a question
- **09-19** — the router had no way back to old mail; opportunities had half a CRM; the weekly brief reached nobody
- **09-18** — a brief that assembles its own evidence; correspondence reaches its record

---

## AT THE END OF EVERY SESSION

Write the full entry to **`docs/BUILD-LOG.md`** (newest first, same voice and detail as the entries already there — the measurements and the ⚠ findings are the point).

In **`CLAUDE.md`**, update only:
- one line under **Recent sessions**,
- any genuinely new durable rule in **§12**,
- **Open items** that changed,
- **§9** if debt was resolved, and the reference sections (§1–§11) if the architecture actually moved.

**CLAUDE.md is a reference, not a journal.** It is loaded in full at the start of every session and is silently truncated above 150,000 characters — which is how a project loses its own operating instructions without anything reporting an error. If it passes ~100k, prune **Recent sessions** back to two weeks and move the rest to the log.
