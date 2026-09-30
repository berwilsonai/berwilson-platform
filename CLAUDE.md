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
zsh deploy/lmstudio-check.sh                           # assert LM Studio: both models loaded, context 131072, no duplicate copy
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
| Vector Search | pgvector inside Supabase Postgres | `text-embedding-qwen3-embedding-0.6b`, **1024-dim — the model's native width, nothing truncated** (was 768 until 2026-09-30). |
| File Storage | Supabase Storage (`documents` bucket) | Organized by project / entity / site ID. |
| Deployment | **Mac Studio, tailnet-only** (launchd + `tailscale serve`) | `zsh deploy/deploy-to-studio.sh` from the MacBook. Vercel deleted 2026-07-07; `git push` = GitHub backup only. Crons are launchd agents on the Studio. |

### AI Model Rules (CURRENT — FULLY LOCAL since 2026-07-07)

**The platform is fully self-hosted and fully local-AI as of the 2026-07-07 cutover** (Richard's decision: absolute security, nothing leaves his hardware). Production = the Mac Studio, tailnet-only: app at `https://richards-mac-studio.tail9acc02.ts.net/`, self-hosted Supabase at `:8443`, LM Studio on localhost:1234. **(The MagicDNS suffix changed `tail0e5306` → `tail9acc02` on 2026-09-16 when the tailnet moved to the berwilson.com Workspace org; the Studio is now `100.102.45.39`. Dated entries below still name the old values — that is history, not current state.)**

- **All runtime AI** → `qwen/qwen3.6-35b-a3b` via LM Studio's OpenAI-compatible API (`AI_PROVIDER=local`, `src/lib/ai/local.ts`). Expect ~30–60s on extraction-class tasks (reasoning-heavy model, ~75 tok/s generation).
- **LM Studio load configuration is load-bearing and resets on an eject/reload** — assert it with **`zsh deploy/lmstudio-check.sh`** (`--fix` reloads at the documented settings), which is now part of the deploy runbook. Found drifted to **173,824** on 2026-09-30, costing +1.38 GiB on a box down to 314MB free with 10.7 of 12GB swap in use, for a window the agent cannot reach (`AGENT_CONTEXT_BUDGET_CHARS` caps a conversation near 88k tokens). Settings (2026-09-26): `--ctx-size 131072` with `--cache-type-k q8_0 --cache-type-v q8_0` — the q8_0 cache is what pays for the doubled window, costing +2.12 GiB over 65,536 f16 rather than +5. `AGENT_CONTEXT_BUDGET_CHARS` and `AGENT_DOC_WINDOW_CHARS` in `.env.local` are sized to it and must move with it. **Check `lms ps` after any reload:** a model id ending `:2` means a SECOND 22GB copy is resident (41GB against 36GB of RAM — seen live), and `--parallel` reverts to 4 whatever it was set to.
- **Embeddings** → `text-embedding-qwen3-embedding-0.6b` at its **native 1024 dims**, stored in `vector(1024)` on BOTH `chunks` and `thread_chunks`. The width lives in ONE place — `EMBEDDING_DIMS` in `src/lib/ai/local.ts` — and must equal the schema; when they match, `localEmbedding` returns the model's vector untouched (the truncate+renormalize branch only runs if `EMBEDDING_DIMS` is deliberately made narrower). **Never mix embedding models OR widths** — either change means wipe + re-embed BOTH tables (`deploy/reembed.mjs`), never one of them. **A chat model, by contrast, is swappable at will**: nothing is fine-tuned, all knowledge is in Postgres, so a better `LOCAL_AI_MODEL` costs nothing to adopt.
- **Office files** → read directly, no model call: `.docx` via mammoth, `.xlsx` and `.pptx` via `fflate` over the OOXML (`src/lib/ai/document-text.ts`). pptx was added 2026-09-27 — before that `documentKind` had no branch for it and decks were skipped with no `documents` row created at all.
- **PDFs** → local text extraction via `unpdf` (no model call for transcription). **Scanned PDFs and images → Apple Vision OCR** (`bw-ocr`, `scripts/ocr/card-ocr.swift`), spawned like whisper.cpp: renders each page at 200 DPI and recognizes it. No model, no RAM held resident, nothing leaves the machine — the 11-page scanned Alaska mining lease read in **3 seconds**. **A vision LLM is deliberately NOT used and there is no room for one:** the box is 36GB, llama-server holds 19.7GB of weights plus 5GB of KV cache, Colima reserves 3GB, and swap already runs full. OCR is also simply better at dense printed text.
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

**Source of truth is `src/types/database.ts` (generated) for everything it covers — but it does NOT cover everything.**

⚠ **`npm run gen-types` is a hard-disabled stub** (`echo … && exit 1`): it used to run `--linked`, which points at the retired cloud project rather than the self-hosted DB. `SUPABASE_DB_URL` is documented in §7 as the replacement and is **referenced nowhere in the repo** — nothing reads it. So the generated types are frozen at whenever they were last produced by hand, and several live tables are simply absent from them: `email_threads`, `mailbox_sync`, `thread_clusters`, `thread_links`, `leads`, `commitments`.

**How to work with that, rather than around it:** code touching those tables uses the deliberately untyped `sweepDb()` client (`src/lib/email-sweep/db.ts`), whose hand-maintained row interfaces carry the contract instead. Follow that convention for any new table until gen-types is repaired; do not scatter `as never` casts. The schema has expanded far past the original core tables, so do not trust a hand-maintained list — read the generated types AND check `docker exec supabase-db psql -U postgres -c '\d <table>'` for anything they do not mention.

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
- **Directory:** `parties` (people + orgs via `is_organization`), `contact_aliases` (uniqueness is on the generated `alias_key` = `lower(alias)`; conflict on `alias_key`, never `alias`), `entities` (legal entities/vendors), `entity_projects`, `party_entities`, `certifications`.
- **Capital raise (2026-07-10):** `investors` (relationship pipeline, links to `parties`), `investments` (investor × target: parent company or project, optional `spv_entity_id` → `entities`), `investor_notes`.
- **Steel CRM (2026-07-25):** `steel_deals` (prefab steel deal pipeline: quote→engineering→order_placed→delivered→paid, lead source, salesperson FK→team_members, sqft/$SF/value), `steel_deal_notes`. Own role `steel_sales` sees only this module.
- **Dino (2026-07-28):** internal operating company (acquired plumbing/HVAC co, dinoservicepros.com — NOT a vendor). `dino_revenue` (source_type internal|external; internal → FK project_id, external → client_name; per-job or periodic lump), `dino_payments` (the $150k/12-mo obligation schedule), `dino_notes`. Tracks the internal-vs-external revenue split (show Dino its revenue increasingly comes from Ber Wilson) + money we owe them. Admin-only. See build-status.
- **Land (2026-09-28):** `project_parcels` (the parcels a project or opportunity is made of — county parcel id, TWO acreage columns for the deal's figure and the assessor's, status, zoning, GeoJSON Polygon/MultiPolygon + centroid). Geometry is imported by parcel id from Utah AGRC's per-county LIR layers (`src/lib/parcels/agrc.ts`), never traced. Absent from the generated types, so it uses the untyped-client convention above.
- **Company:** `company_profile`, `media`.
- **Correspondence routing:** `record_identifiers` (2026-09-25 — parcel numbers and owning entities learned from a human filing decision, matched by the router like a solicitation number; see `src/lib/email-sweep/identifiers.ts`). `thread_links` carries TWO cursors — `applied_message_count` for text, `attachments_through` for documents.
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
- Error boundary + `loading.tsx` on every route. *(Aspirational — 41 of 81 pages have one; `/tasks` and the whole `opportunities/[id]` tab family do not.)*
- **Form controls come from `src/components/ui/field.tsx`** (`Field`/`Input`/`Select`/`Textarea`/`FieldDate`/`FormSection`/`FormGrid`/`FormActions`), or at minimum from the class strings in `src/lib/utils/field-classes.ts`. Never a new local `inputClass`/`labelClass` — there were 29 of them. `Field` ties the label to the control via `useId`; pass an explicit `id` in a `<form action>` form, which submits by `name`.
- **Focus is `focus-visible:`, never `focus:`** — the latter fires on mouse clicks too. Follow `button.tsx`: `outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`.
- **Never print a stored enum at a reader** — `enumLabel(value, map?)` in `src/lib/utils/constants.ts`. Its humanising fallback matters: several of these columns are not controlled enums, so a map-only lookup renders blank.
- **Money is `formatValue` (abbreviated) or `formatMoney` (exact)**, both in `constants.ts`. No local copies; there were five.

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
AGENT_MAX_TOOL_ROUNDS=           # optional; tool-call rounds per agent turn (default 12). The LAST round runs with no tools, so a turn always ends on an answer — §12
AGENT_TIME_BUDGET_MS=            # optional; wall clock after which the agent's next round becomes the closing one (default 240000)
AGENT_CONTEXT_BUDGET_CHARS=      # conversation chars before the OLDEST tool results are shrunk to stubs (code default 120000; SET TO 300000 here). ~13k tokens of every request is fixed overhead, so this MUST track the LM Studio context — 120000 suits a 65,536-token window, 300000 suits the 131,072 now configured — §12
AGENT_DOC_WINDOW_CHARS=          # chars of a document returned per get_document_content call (code default 20000; SET TO 40000 here ≈ 10k tokens). Raise WITH the LM Studio context, never ahead of it
LOCAL_AI_STREAM_FIRST_CHUNK_TIMEOUT_MS= # optional; wait for the FIRST streamed chunk (default 900000). Prompt processing scales with context and streams nothing, so this must be far larger than the gap cap below. Sized from measurement: prefill runs ~215 tok/s, so a FULL 131,072-token window is ~610s of silence before the first token
LOCAL_AI_STREAM_IDLE_TIMEOUT_MS= # optional; gap cap BETWEEN chunks once streaming has started (default 180000)
LOCAL_AI_TIMEOUT_MS=             # optional; cap on response HEADERS only (default 900000). With stream:true they arrive in 0.1s, so a wait here means LM Studio is not answering at all
LOCAL_SUMMARY_INPUT_CHARS=       # optional; document chars fed to a SUMMARY pass (default 30000). Deliberately not raised with the window — a summary only has to say what a document is so the agent opens it
LOCAL_PDF_TEXT_MAX_CHARS=        # optional; cap on STORED document text (default 2000000). Was 240000 and silently truncated real documents; no longer a context guard since reads are windowed
OCR_DPI=                         # optional; render resolution for scanned PDFs (default 200). 72 reads body text but is marginal on small print
OCR_MAX_PAGES=                   # optional; page ceiling per scanned document (default 300)
OCR_DOCUMENT_TIMEOUT_MS=         # optional; whole-document OCR cap (default 900000)
CRON_SECRET=                     # Bearer auth on cron routes; launchd cron agents on the Studio send it
APP_URL=                         # tailnet base URL for links in outbound notifications (task digest "Open my tasks")
SUPABASE_DB_URL=                 # ⚠ ASPIRATIONAL — nothing reads this, and `npm run gen-types` is a disabled stub. See §4
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
GOOGLE_MEET_FOLDER_ID=           # optional; where Meet files recordings/transcripts. UNSET = resolve a folder named "Meet Recordings" OR "Google Meet" in each exec's own Drive. Google has used both names and renamed it under us — matching only the old one is why this importer ran 192 times and imported nothing. Add to MEET_FOLDER_NAMES rather than setting this
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
- **`unique (a, b, c)` WHERE ONE COLUMN IS ALWAYS NULL ENFORCES NOTHING.** The shared-children convention (§4) puts NULL in exactly one of `project_id`/`opportunity_id` on every row, and Postgres's default rule says two NULLs are never equal — so the constraint matches nothing, `ON CONFLICT` never fires, and every re-import silently stacks a second copy of the whole set. `unique nulls not distinct` (PG 15+). — 09-28
- **A `.neq()`/`.eq()` VALUE THAT IS NOT IN THE ENUM FAILS THE WHOLE QUERY, NOT THE ROW.** `.neq('status','archived')` on `projects` — which has no `archived` member — returned `22P02 invalid input value for enum project_status` and a NULL row set, so a record picker rendered with only half its records and no error anywhere on screen. Check the enum's members before filtering on one; and remember `.neq` is separately untrue for a NULL column, so even a valid value would have dropped rows. — 09-29
- **A LIST CAPPED AND SORTED `nullsFirst:false` DROPS EXACTLY THE NEWEST RECORDS FIRST.** `/leads` takes 300 ordered by bid date then fit score, both nullsFirst:false — so a lead with NEITHER sorts dead last, which is precisely a just-created one. A deep link that seeds its open state from that window silently opens nothing for the one record the link was about. Fetch a deep-linked id explicitly rather than hoping it is in the page. — 09-29
- **AN INSERT THAT WAS SAFE ONLY BECAUSE THE PARENT WAS BRAND NEW BREAKS THE MOMENT THE SAME PASS CAN TARGET AN EXISTING ONE.** The intake confirm route inserted `project_players` with no error check — harmless against a record created three lines earlier, a `unique (project_id, party_id, role)` violation as soon as the destination could be a curated record that already holds that person. And the opportunity half of that constraint is a PARTIAL unique index, so it cannot be an upsert either. Read the roll first, skip what is already there, and COUNT the skips. Adding a destination to a write pass means re-reading every insert in it for a constraint the new parent may already satisfy. — 09-30
- **A multi-row insert is ONE statement with a uniform column list.** Rows that omit a column get an explicit NULL, not the default. — 09-15
- **PostgREST truncates at 1000 rows, silently.** Paginate any select that could exceed it. — 09-22
- **A UNIQUE INDEX on an EXPRESSION is not a conflict target PostgREST can name.** `onConflict: 'alias'` against a `unique(lower(alias))` index fails every call with "no unique or exclusion constraint matching the ON CONFLICT specification". A UNIQUE CONSTRAINT cannot sit on an expression either — add a generated stored column and constrain that. — 09-24
- **Never string-compare a Drive `modifiedTime` against a stored `timestamptz`** — PostgREST round-trips with an offset (`…Z` vs `…+00:00`), so they are never equal. Compare instants. — 09-05
- **Check what a table CONTAINS, not just how many rows it has, before calling it unused.** — 09-22
- **`lms load --estimate-only` ANSWERS "CAN THIS BOX HOLD MORE CONTEXT", AND HAND ARITHMETIC DOES NOT.** Measured for Qwen3.6-35B-A3B: **23.30 GiB at 65,536 tokens, 25.42 GiB at 131,072 — a delta of 2.12 GiB**, and `--parallel` changes neither figure. Computing it by hand from the GGUF metadata (40 layers × 2 KV heads × (256+256) = 81,920 bytes/token → 5.00 GiB at 65k) **overstated it by more than double**, because flash-attention and the MoE layout do not allocate what the naive formula implies. Ask the tool; it knows its own allocator. — 09-26
- **`--parallel` is not a memory lever, though `lms ps` showing 4 invites the assumption.** `--estimate-only` returns the identical figure at 1 and at 4, and a 28,018-token prompt succeeded against `--ctx-size 65536 --parallel 4`, so the four slots neither cost memory nor slice the usable window. Set it to 1 because the platform never issues concurrent requests, not to free anything. — 09-26
- **NEVER RUN OCR AND THE LLM AT THE SAME TIME ON THIS BOX.** With the 22GB model resident, swap hit 21.5GB/295MB-free and `bw-ocr` rendering an 18.5MB scan at 200 DPI was being killed — 2 documents in 20 minutes, six readable ones written off as `skipped`. `lms unload` drops wired memory 25.4GB → 4.3GB; the same backfill then did **28 of 34 in ~7 minutes**. OCR needs no model, only the 639MB embedder, so extract text with the LLM unloaded (`--text-only`) and fill summaries in a second pass. — 09-26
- **A NULL `ai_summary` IS A DOCUMENT THE AGENT NEVER OPENS.** `list_documents` and `get_record_brief` present a document *by* its summary, so a text-only backfill leaves files that read as empty: Ber AI said *"the lease is a scanned PDF the platform cannot read"* while `get_document_content` returned its 665 acres on request. The summary is the signpost, not decoration — a text pass is not finished until the summaries follow. — 09-26
- **CHECK THE MACHINE'S MEMORY BEFORE RECOMMENDING A MODEL.** Asked which vision model to load, the honest answer was *none*: `free` was 0.3GB, `wired` 25.8GB and **swap 17.2 of 18.4GB used**, with llama-server at 19.7GB and Colima reserving 3GB. A 7B VL model is another ~6GB on a box already paging. Apple Vision OCR — already installed, no model, no resident RAM — read the 11-page scan in 3 seconds and found the figure the agent had been asked for three times. — 09-26
- **NEVER MAKE THE MODEL COUNT ROWS — PRINT THE COUNT.** Handed a 69-row claim schedule and asked how many claims it holds, the local model answered **62**, and split them across townships wrongly too. The count is the figure an executive repeats out loud, it is arithmetic rather than judgement, and a line of code is exact at it. Extractors state row counts; the model groups and interprets. — 09-26
- **THE TRAPEZOID AREA AND THE CROSS-PRODUCT CENTROID HAVE OPPOSITE SIGNS.** `(x_j + x_i)(y_j - y_i)` is the same area as the shoelace with the sign flipped; dividing a cross-product centroid sum by it negates BOTH coordinates, and a parcel in Utah imports at 39.24 S / 112.66 E, in the ocean off Western Australia. Nothing reports it — the geometry is stored raw and draws perfectly, so only the fly-to target is wrong. Assert the centroid falls inside its own bounding box. — 09-28
- **A blank spreadsheet cell is ABSENT from the XML, not empty in it.** Reading `<c>` elements in sequence without honouring each one's `r="C12"` column reference shifts every value after a gap one column left — silently pairing a claim number with the wrong section. — 09-26

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
- **A VENDOR'S FOLDER NAME IS A UI STRING, NOT AN API CONTRACT.** Google renamed the Meet output folder from `Meet Recordings` to `Google Meet`, and matching the old name exactly had `cron-meet-import` report `noMeetFolder` **192 consecutive times against a Drive that had one** — every run green, the feature never once working. Match a LIST of names (`MEET_FOLDER_NAMES`) and have the failure message say what it looked for. — 09-28
- **Meet files the real artifact in the ORGANIZER's Drive and a `…apps.shortcut` in every other participant's.** Both exec mailboxes are swept, so filtering to real Google Docs is what stops one meeting being imported, summarized and staged twice. Verified live: moose@ 3 documents, tuaone@ 3 shortcuts. — 09-28
- **One Meet meeting is ONE SUBFOLDER, not a file.** A flat `'<folderId>' in parents` listing of the Meet folder returns nothing but folders. And `listFolder` counts the folder it is handed as level **1**, so `maxDepth: 1` returns zero files and `2` is "this folder and the meeting folders in it" — measured, not reasoned. — 09-28
- **`embedOpportunityDocument` inserts chunks but does NOT settle `embedding_status`**, and the column defaults to `pending` — which the UI renders as "Indexing…" forever. `embedDocument` (the project path) settles its own. Settle it yourself on the opportunity side. — 09-28

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
- **A NEW CRON ROUTE IS UNREACHABLE UNTIL `middleware.ts` NAMES IT.** The gate runs first, so the route's own `CRON_SECRET` check never executes and the reply is `{"error":"Not authenticated"}` — not the route's `Unauthorized`. Nothing catches this: it typechecks, builds, registers, and then 401s at its scheduled hour into a log nobody reads. Tell the two apart by which word comes back. — 09-24

### Studio / infrastructure

- **The Tailscale serve config is Tailscale's state, not ours.** Assert BOTH listeners on every deploy (`zsh deploy/tailnet-setup.sh`). Losing them takes the platform down while every local check still reports healthy. — 09-09
- **Changing tailnet changes the MagicDNS suffix, and `NEXT_PUBLIC_*` is baked in at BUILD time** — a tailnet move needs `--fix` then a full rebuild, never just a restart. — 09-16
- **A cursor that gates two different jobs gates neither correctly.** `applied_message_count` decided both "what text to post" and "what attachments to import", and every filing path seeds it at the thread's current length so old mail is not replayed as news — which made the attachment slice permanently empty. 178 attachments against 30 ever imported. The text of old mail is not news; a deed is still a deed. Give the second job its own cursor. — 09-25
- **A failure inside a loop must hold the cursor, not just `continue`.** A `continue` past a failed fetch still let the end-of-run advance fire, so the file was lost rather than retried — and lost silently. Gmail's per-MINUTE metering makes this fire exactly when pulling several large attachments in a row. — 09-25
- **A FILE NAME IS NOT EVIDENCE OF SAMENESS, AND NEITHER IS SIZE.** Four parcels' title commitments are all called `Title Commitment - AS.pdf` and sit within 1.1% of each other (1,091,743 → 1,103,229 bytes), so a name rule discards three and any tolerance wide enough for a re-encode discards them too. Hash the bytes; rename the collision after the thing it identifies. — 09-25
- **`isInline` is not sufficient to spot mail chrome — it is the MIRROR of the Content-Disposition rule above.** Replying from Gmail re-attaches the sender's signature images *as attachments*, so `image001.png` lands on the project as a document. The name is what survives: `image001.png` / `ATT00002.png` / `oledata.mso` are client-generated and never a person's file. — 09-25
- **The sender is never the key to which deal mail belongs to.** A title company, a law firm and a bank each work across many deals at once. What identifies the deal is the PROPERTY — a parcel number permanently, the owning entity for the length of a negotiation. Learn those from a human filing decision and match them like a solicitation number. — 09-25
- **A matcher must never learn from its own matches.** Identifiers are read by the router and written only by a human filing act; self-teaching compounds, attaching a neighbouring parcel quoted in a forwarded chain and then filing the neighbour's deal there. Every identifier traces to someone saying "this belongs here", which is what makes a misfiling undoable. — 09-25
- **An extractor that sounds right must still be counted against the corpus.** `summary.counterparty` answers "whose deal is this" with the wrong KIND of answer: over 2,492 threads it produced `Carbon County`, `Bank of Utah`, and `Richard White` — the reader himself. 164 candidate identifiers became 15 once counterparty was dropped and civic/geographic names were banned. A name that many deals share is the one thing an identifier must not be. — 09-25
- **Work fired off after a route handler returns dies with the next `launchctl kickstart`** — and a deploy IS a kickstart. Store what the pass would need to resume (the already-recognized text, the already-fetched rows), and write progress back after every unit, or an interrupted run is indistinguishable from a lost one. — 09-24
- **`next start` loads the build at boot.** A rebuild without `launchctl kickstart` changes nothing — three sweep phases ran only by hand for nine days because of this. — 09-20
- **Check `lms ps` against the documented config before blaming code** for slow or stalled AI; an LM Studio update resets it. The tell is a model id ending `:2`. `parallel` is the costly setting, not context, and `lms unload` takes no `-y` (passing it loads ANOTHER copy). — 09-14
- **Do not run a backfill and a deploy at the same time on this box.** If the app 000s after a kickstart, check free memory and the service's exit code (−9 = OOM-killed) before suspecting Supabase. — 09-14
- **Do NOT edit a shell script while it is running** — zsh reads by byte offset, so the running copy resumes at a garbage position and dies with a syntax error that is not there. — 09-23
- **`supabase db push --linked` targets the WRONG database** (the retired cloud project). Apply migrations by piping SQL to `docker exec supabase-db psql` over ssh; back up any table being dropped first. — 08-23
- **After killing a sweep mid-run, clear `page_token`** or the next cron resumes from that cursor and re-ingests everything. — 09-09
- **A backup is not a backup until it has been read back** — and its filename needs seconds, or a same-minute retry overwrites the good copy. — 09-15
- **LM Studio serves ONE request at a time.** Overlapping crons queue behind each other; that is why the digest is 7:00am and the brief 6:30am. — 09-23
- **A CHAT MODEL IS SWAPPABLE AND AN EMBEDDING MODEL IS NOT, AND THAT ASYMMETRY IS THE WHOLE ANSWER TO "DO WE LOSE ANYTHING BY UPGRADING".** Nothing here is fine-tuned — every fact lives in Postgres — so a better `LOCAL_AI_MODEL` is a one-line env change with no migration and nothing relearned. An embedding model is the opposite: a stored vector is only meaningful against the model AND the width that produced it, so changing either invalidates every row in `chunks` AND `thread_chunks` at once. There is no incremental path and no partial one. — 09-30
- **THE EMBEDDER'S NATIVE WIDTH WAS 1024 AND THE SCHEMA WAS `vector(768)`, SO A QUARTER OF EVERY VECTOR WAS DISCARDED — ON EVERY CHUNK AND EVERY QUERY.** Matryoshka training makes the leading slice a valid embedding, so nothing ever looked broken: no error, no warning, retrieval simply ran on 75% of the signal on a platform whose whole job is combing through the corpus. A truncation that is *legal* still costs accuracy. Check what the model actually returns (`curl /v1/embeddings | jq '.data[0].embedding | length'`) against `EMBEDDING_DIMS` before assuming the schema was sized to the model. — 09-30
- **A RE-EMBED SCRIPT THAT MISSES AN INDEX IS WORSE THAN NO RE-EMBED SCRIPT.** `deploy/reembed.mjs` covered `chunks` and never `thread_chunks` — the entire correspondence index, 6,498 rows — so any model swap would have left two incompatible vector spaces in one database and reported success. It also selected `summary` from `documents`, where the column is `ai_summary`: supabase-js returns that 42703 on `error`, the script destructured only `data`, and the phase read `documents: 0/0` **having indexed no document at all**. A zero from a broken query and a zero from an empty table are the same number on screen. Check `error` on every select, page every one of them (PostgREST caps at 1000 silently), and count the REASON beside the number — "skipped: no text" is a correct outcome, a failure is not. — 09-30
- **UNLOAD THE CHAT MODEL BEFORE ANY RE-EMBED OR BACKFILL, FOR THE SAME REASON AS OCR.** `lms unload` drops wired memory 25.4GB → 4.3GB on a 36GB box; the 639MB embedder then holds the whole machine and runs at its measured 8 chunks/sec (~125ms each) instead of competing with 22GB of resident weights for a box already at 314MB free. The embedder is the only model a re-embed needs. — 09-30

### Design / process

- **A DESTINATION THAT DOES NOT CARRY WHAT CREATING CARRIES READS AS LOSING THE WORK.** `merge` shipped 09-25 doing exactly what its header said — handing an EXISTING record id to `linkClusterToRecord` — and nothing else: the report, the people, the tasks and the staged attachments the run had assembled were discarded silently, so `/decide`'s "Merge → X" quietly cost more than it saved. The threads pointed at the right deal and the deal never heard what they said. If two paths differ only in WHERE the work lands, they must be one pass with a target parameter (§12) — never one full pass and one shortcut. — 09-30
- **A SHARED RENDERER WIRED TO ONE SURFACE IS WORSE THAN NO SHARED RENDERER.** `BriefMarkdown` was written explicitly so the printed brief would be the document read on screen — and only the print route used it. The screen showed literal `##` and `[CRITICAL]` under a `prose [&_h1]:… [&_h2]:…` wrapper whose every selector was dead, because the string it styled produced no elements. Before building a renderer, grep for one; after building one, grep for every surface that should call it. — 09-26
- **AN EXHIBIT IS OFTEN DATA WEARING A PICTURE, AND THE SHEET USUALLY NAMES ITS OWN SOURCE.** The Delta rezone exhibit's disclaimer said "publicly available Millard County / Utah AGRC parcel geometry" — so its 11 parcel footprints were fetchable by the same ids the sheet prints, rather than traced or OCR'd. Before filing a plan as an image, read its title block and disclaimer for a schedule and a provenance; what is left over after the data is extracted is the only part that is genuinely a picture. — 09-28
- **FILLING A BLANK AND OVERWRITING A VALUE ARE DIFFERENT ACTS, AND ONLY ONE OF THEM IS SAFE TO AUTOMATE.** Attaching a staged package to an EXISTING project exists precisely because a human already curated that record, so the pass fills only NULL/whitespace columns, never renames, and reports which ones moved. The exclusions are the interesting part: a NOT NULL column (`projects.sector`, `opportunities.opp_type`) is never blank, so "filling" it could only mean overwriting; and `stage`/`status` are a judgement no email reports. An importer that fills and names what it filled can be trusted twice; one that chooses cannot be trusted once. — 09-30
- **TWO SOURCES FOR ONE FIGURE GET TWO COLUMNS, NOT A WINNER.** The application said HD-5534-A-1 was 13.00 acres and the county assessor said 4.69. Picking either loses the fact that anyone disagreed, which on a rezone is the fact worth keeping — and an importer that COMPARES surfaces it on the first run, where an importer that chooses never would. — 09-28
- **DEFINING A HELPER IN THE COMPONENT BODY CAN DESTABILISE A FUNCTION IT CALLS**, and the React Compiler's exhaustive-deps rule then reports it against effects you did not touch — two long-standing clean effects started warning about `ensureOverlays` because a new `ensureParcels` sat beside it. The warning is a design signal, not noise to suppress: a layer builder needing only its arguments belongs at module scope. — 09-28
- **CHECK WHETHER THE DATA IS ALREADY ON THE ROW BEFORE CALLING A LIST "AN EXTRACTION PROBLEM".** `/decide` buried value, location, sector and deadline inside a truncated paragraph while `leads` carried all four as columns and the page already did `select('*')`. The viewmodel was flattening them away. It looked like schema work and was a UI change. — 09-26
- **A CACHE IN `localStorage` FOR CONTENT THAT LIVES IN THE DATABASE IS NOT A CACHE, IT IS THE ONLY COPY THE PAGE CAN SEE.** The project brief was invisible to any browser that had not generated it — a second executive, a new laptop, a cleared cache — and a failed regeneration blanked the panel while a good brief sat in `stored_briefs`. Read the stored copy server-side and let the refresh only improve on it. — 09-26
- **ONE QUANTITY, ONE DEFINITION, OR THE READER TRUSTS NONE OF THEM.** Three "needs attention" numbers were on one screen — 1, 99+ and 197 — because the layout, the KPI tile and the rail each summed their own list, and the tile folded the whole Decide queue into it and then restated it in its own sub-label. Two different quantities must be named apart and never summed; a badge cap that turns 197 into `99+` invents a third. — 09-26
- **A BARE EM DASH AT A VALUE'S OWN WEIGHT READS AS A FAILED RENDER.** Omit the row, or name the absence in words ("No value set", "no date agreed"). And a KPI tile with no value is not a KPI tile — it was holding a quarter of the band to display a two-line instruction. — 09-26
- **WHEN EVERY ROW IS RED, RED HAS STOPPED SIGNIFYING.** Nine consecutive commitments at 227d, 218d, 117d… all in alarm colour. Band it and reserve the colour for what is still actionable. — 09-26
- **FIXING A GENERATOR CHANGES NOTHING THE READER SEES.** `Bid due — ` and `Ber AI: PURSUE (82/100).` were written into `tasks.title`/`tasks.why` at insert time, and the same columns are what Pepper emails and what Google Tasks shows on a phone. Back the existing rows up, then rewrite them. — 09-26
- **A CONTROL THAT ONLY APPEARS ON HOVER DOES NOT EXIST ON A PHONE**, and one without `focus-visible:opacity-100` can be focused by a keyboard user who cannot see it. Gate the hiding on `sm:`. Two of the fifteen were deletes. — 09-26
- **`focus:ring` FIRES ON A MOUSE CLICK TOO.** 248 sites used it, so clicking into any field flashed a ring. `focus-visible:` is the one that means "reached by keyboard". — 09-26
- **A COLUMN WITH A `<select>` IS NOT AS WIDE AS YOU WROTE IT** — a native select sizes to its widest option, so one long project name stretched a filter to half the row and wrapped the other three. Bound it. — 09-26
- **THE LONGEST FORM IS NOT THE WORST FORM.** `ProjectForm` and `SteelDealForm` are the two best-structured in the repo; the a11y debt was in six short ones. Measure the rule against the corpus before ordering the work by file size — and `control-has-associated-label` is the noisy jsx-a11y rule (334 hits here, 6:1 false positives), while `label-has-associated-control` found the real 101 in 22 files. — 09-26
- **DO NOT WIZARDIZE A SERVER-ACTION FORM.** `<form action>` + `useActionState` submits one `FormData` from one form; steps mean either hiding fields with CSS (and the browser's "required field is hidden" failure) or lifting every field into client state and rewriting both action signatures. `ProposalIntakeWizard` is not the precedent — its steps exist because step 2 cannot run until step 1 returns. Collapsible sections get the same benefit with every field mounted. — 09-26

- **A FILE TYPE WITH NO BRANCH IS INVISIBLE, NOT UNREADABLE — AND NOTHING REPORTS IT.** `documentKind` had no pptx case, so the Drive sync classified two investor decks as "unsupported", skipped them, and created **no `documents` row at all**: nothing listed them, no status came back, and the deck stating the $88M raise was absent from the knowledge base for weeks. An unsupported type at least leaves a row to find. Before adding a source, check the extension list actually covers what the folder holds. — 09-27
- **AN UNLABELLED COUNT IS NOT A COVERAGE SIGNAL.** `drive-sync` incremented one `skipped` counter from six different branches, so the nightly log read `skipped: 26` whether nothing was wrong or a deck was being dropped. Count the REASON beside the number, or the number only tells you something happened. — 09-27
- **READ `documents` WITH `superseded_at is null` OR THE GRAVEYARD READS AS A GAP.** Ten documents held real text and no chunks — an 88k-character proposal among them — and looked like a silent indexing failure worth a backfill script. All ten were deliberately retired duplicates whose live twins are indexed. The script found 0 candidates the moment the filter was added. — 09-27
- **A KEYWORD SEARCH THAT ONLY MATCHES THE WHOLE PHRASE ANSWERS "NOTHING" WHERE IT MEANS "NOT ADJACENT".** `ilike '%title commitment%'` returned zero against five Highland Title threads about title commitments. Zero rows reads as "there is no such correspondence", which is the one wrong answer. Fall back to any-word — **and rank the fallback by how many words matched**, because a wide net ordered by date answered "Hill AFB site visit" with meeting notes that merely said "site". — 09-27
- **MAIL GATEWAY NOISE RANKS.** Proofpoint/ATP/Inky leave 300-400 character link wrappers and encoded runs in every message; chunked and embedded they compete with prose, and a hex dump was the TOP passage for a question about a title commitment. Scrub at index time AND at read time — the read-time pass is what reaches the thousands of chunks already indexed without a re-embed. `src/lib/ai/text-noise.ts`. — 09-27
- **SCRUB THE PASSAGE, DO NOT WITHHOLD IT.** The chunk that prompted the noise work opened with 300 characters of hex and continued into Ericson writing to Highland Title. Dropping the passage costs the answer; dropping the run costs nothing. Withhold only what is left with nothing in it, and never the last one — an empty result reads as "there is no correspondence on this". — 09-27
- **A NOISE FILTER MUST BE MEASURED AGAINST THE CORPUS, AND EVERY CLEVER VERSION COSTS EVIDENCE.** Share-of-prose below 35% withheld 11.6% of the index including "Site Visit - IDIQ @ HAFB" and three bid invitations; share-of-short-tokens below 50% was worse at 14.4% and took them again, because a BuildingConnected invite is mostly long links and links are content. Density of ordinary words below one per forty characters withheld 2.2% with zero false positives over 256 bid and title passages — **and had to count figures as words**, or it withheld the insurance ledgers, where every cell is a number. — 09-27
- **`fetch` HAS A 300s CEILING ON PROMPT PROCESSING THAT NO OPTION IN THIS CODEBASE CAN REACH.** undici (Node's fetch) enforces its own `headersTimeout` AND `bodyTimeout`, both 300s, neither touched by the `AbortSignal` or by `LOCAL_AI_TIMEOUT_MS`. Asking for `stream:true` dodges the first — headers come back in 0.1s — and hands the socket straight to the second: nothing streams while LM Studio ingests the prompt, undici reads that silence as a dead body, and the socket dies at five minutes as a bare `TypeError: terminated` (cause `UND_ERR_BODY_TIMEOUT`). So the 600s first-chunk guard written on 09-27 was **never once reachable**, the turn's tool work was discarded, and the word that reached the reader was `terminated`. The chat stream goes over `node:http`, which applies no such timeout; raising an undici setting instead would mean adding a dependency (§11) to configure a client we do not otherwise want. — 09-29
- **THE KV PREFIX CACHE IS WHY A ROUND IS NORMALLY FAST, AND SHRINKING THE CONVERSATION IS WHAT THROWS IT AWAY.** Measured: the same prefix re-sent returns its first token in **3.2s against 68.3s cold** — 21x. An agent round therefore only re-pays full prefill when the prefix CHANGES, which is precisely what `AGENT_CONTEXT_BUDGET_CHARS` does when it stubs the oldest tool results. Rewriting the middle invalidates the cache from that point and the next round re-prefills ~88k tokens (~285s), so the cost lands on the longest, best-evidenced turns — the ones that were already nearest the ceiling. Append; do not rewrite, if there is ever a choice. — 09-29
- **PREFILL IS ~308 tok/s UNCONTENDED AND ~215 tok/s BEHIND A CRON**, measured 09-29 (21,025 tokens → 68.3s; 29,121 → 135.5s while queued). LM Studio serves ONE request at a time (§12), so a cron holding the model is added to the caller's own wait — and a latency measured while something else is running is measuring the queue, not the model. A full 131,072-token window is ~425s of silence before the first token. — 09-29
- **A TIMEOUT SERVING TWO DIFFERENT WAITS IS SET WRONG FOR BOTH.** `Local AI stream stalled — no data for 180s` killed real agent turns: nothing streams while the server ingests the prompt, so the silence BEFORE the first token grows with the conversation, while the silence BETWEEN tokens does not (generation holds ~75 tok/s whatever the context). Wait generously for the first chunk (`LOCAL_AI_STREAM_FIRST_CHUNK_TIMEOUT_MS`, 600s) and keep the gap cap tight after it. — 09-27
- **A URL THE MODEL NAMES IS A GUESS UNTIL IT IS FETCHED.** Asked for two lawyers at one firm, grounded search returned one real bio page and one 404, plus a LinkedIn URL answering 999 — two path patterns from one CMS, so at least one was invented. Fetch every candidate, and require the PAGE to carry the evidence (the person's own name) before believing it. The danger is never the 404; it is a valid page about a different person of the same name. — 09-27
- **A SHARED INDUSTRY WORD IS THE ONE THING A COMPANY IDENTIFIER MUST NOT BE.** Matching an organisation to a domain on any keyword substring put `bfaenergy.com`'s logo on **Bloom Energy**, because `bfaenergy` contains `energy`. A domain must START with the organisation's leading distinguishing word, and industry words (`energy`, `mining`, `capital`, `steel`…) belong in the stopword list beside `LLC`. — 09-27
- **`GEMINI_API_KEY` IS ON THE FREE TIER: 20 `gemini-2.5-flash` REQUESTS PER DAY.** Every web-research feature shares that budget, and Enrich Profile spends three per contact — so the button is good for about five contacts a day. It presents FIRST as `503 high demand` and only later as an explicit `429 … GenerateRequestsPerDayPerProjectPerModel-FreeTier`. Never retry a daily quota (backing off seconds against a 24-hour window is waste), always cap the SDK's own wait (it has no timeout and will sit on a stalled request for minutes — seven for one contact, measured), and stop a batch at the wall rather than recording its remaining rows as genuine misses. — 09-27
- **A FALLBACK IS A CONCLUSION, AND IT CAN ONLY BE DRAWN FROM A CHECK THAT RAN.** Falling back to a company logo when the headshot search had 429'd — rather than searched and found nothing — would have written an avatar for every remaining contact, excluded them from every future pass, and capped the directory at logos on the strength of one bad afternoon. Distinguish "looked and found nothing" from "never looked". — 09-27
- **A PROVENANCE LINE THAT INVENTS A PROVENANCE IS WORSE THAN NO LINE.** `originNote` was written two-way (email vs web form) and so told a lead staged from a MEETING that it came "from an email enquiry" — no sender, no mailbox, no email — and that sentence is written onto the record as its description, where it outlives the lead and a reader has no way to tell it is wrong. Every arm of a provenance string must be true for every source, and adding a source means checking all of them. — 09-29
- **A NEW RECORD TYPE IS A DESTINATION FOR THE HUMAN, NEVER A CLASSIFICATION FOR THE MODEL.** Adding a `'lead'` kind to the meeting extraction was the obvious move and is wrong: the model has no sight of the database, a call about a live project reads exactly like a call about a site nobody has heard of, and the mis-classification would skip record matching altogether. Ask the model what a thing IS; let the human pick where it goes, on the screen where the match result sits beside the name. — 09-29
- **A UNIQUE INDEX ON A FOREIGN KEY MEANS ONE CHILD, AND SILENTLY KEEPING THE FIRST IS WORSE THAN KEEPING NONE.** `tasks.lead_id` is unique (it latches the bid-deadline sync), so a call raising three follow-ups about one lead can have at most one as a task. They are kept as note TEXT instead and the UI says so in place. When a constraint means a set cannot be stored, store none of it and name what you did — do not store an arbitrary member. — 09-29
- **A coverage count is the only honest signal for a feature whose failure mode is doing nothing.** A count that has stopped growing is indistinguishable from a quiet inbox — measure AGE instead. — 09-09, 09-20
- **Never fork a shared pass per table — add a target.** The one forked copy of `runDocumentAiPass` silently discarded 413,000 characters. — 09-17
- **A dedupe key derived from a conversation's FIRST message identifies the conversation, not its contents.** Never use one to decide "already seen". — 09-09
- **Split the instant local step from the slow remote one, and run the local step first.** Recognition is a second; research is two minutes. Doing all the recognition up front tells the reader which photo to retake while the card is still in their hand, keeps a dozen 6MB uploads off one request, and means only text is in play by the time anything slow starts. — 09-24
- **Measure before building.** Repeatedly the premise was wrong: the Drive was already clean, the local model is 93% idle because it has FINISHED, and three planned passes were built and then REMOVED after measuring them. — 09-22, 09-23
- **`fit_score` carries ±20 points of sampling noise.** Read the pursue/consider/pass verdict, never the number; do not sort or threshold on it. — 08-26
- **Ambiguity must mean NO match.** Two records scoring identically on a name is the case that must refuse, not guess. — 09-09
- **A mailbox is a better key than a name.** `commitments.owner_name` holds four spellings of one man, the company itself under two (`Ber Wilson`, `Bear Wilson`), a bare `Hola`, and 31 nulls — while every row carries the mailbox of the thread it came from. Resolve the name when it clears a strict bar; otherwise ask whose correspondence it is, which is answerable. And check what the field MEANS on each side first: for `side='them'` the owner is the counterparty, so resolving it to a teammate says someone owes themselves. — 09-24
- **Never print a reader's own name back at them.** "Review and sign the MNDA — extraction named: Richard White", rendered into Richard's own note, came back as "Richard White is waiting" — a third party invented out of the recipient. When the owner IS the reader, the name is not information; "this one is yours" is. — 09-24
- **One match is not a unique match — it is an unchallenged one.** A lone hit on a weak key (a bare first name) resolved "Cliff" to an unrelated academic on a live deal. Require a strong key, or refuse and say what was found. — 09-24
- **A fuzzy threshold is measured against the real corpus, never chosen.** And a score too low to act on is still worth SUGGESTING — "closest in the mail" costs the reader a glance; an auto-resolve at the same confidence files the wrong person. — 09-24
- **SOMETIMES THE MEASUREMENT SAYS A THRESHOLD CANNOT WORK, AND THEN THE QUESTION IS WHICH WORD MATCHED.** `matchReferencedRecords` had no floor at all, so "Eagle Mountain Development" arrived PRE-TICKED as **Myton Development at 0.487** while the correct "Delta, Utah Campus" → "Delta Industrial Campus" scored **0.390** — the wrong match ranks higher, because four live projects share the word *Development*. Require a shared identity-bearing word (generic list: `development`, `project`, `site`, `campus`, `expansion`…), and keep PLACE names out of that list — Myton, Delta, Heber and Tooele are exactly what distinguishes these records. Measured: 14/14 self-matches kept, the false positive dropped, the true positive kept. — 09-28
- **A thread with more than ~15 participants is a distribution list, not a conversation.** Its recipients are not a deal cast: two 35-recipient invitations buried the five people who mattered under thirty strangers. Measured — 2,391 of 2,436 threads have five or fewer. — 09-24
- **AN AGENTIC LOOP MUST END ON AN ANSWER, WHICH MEANS THE LAST ROUND CARRIES NO TOOLS.** `for (round = 0; round < 5)` then falling out of the bottom shipped the NARRATION as the answer — three consecutive turns stored *"Let me pull the claim list and lease document."* and nothing else, one of them 99 characters long, after 6-9 tool calls each. The round count is the lesser half of the fix: strip the tool declarations on the closing round and instruct that a PARTIAL answer with its gaps named is the required output. A budget cliff and the assistant giving up mid-sentence look identical from the chair. — 09-26
- **Raising a round budget without a context guard trades one silent failure for a worse one.** Measured: system prompt 17.5k chars + company context 4.9k + 42 tool declarations 30.2k ≈ **13k tokens of fixed overhead per request against a 65,536-token window** — so ten 20k-char document windows fill it. Shrink the OLDEST tool RESULTS as the conversation grows, never remove a message: an OpenAI-format `tool` message must keep following the `assistant` message whose `tool_calls` it answers. — 09-26
- **A truncating reader with no continuation parameter is not a reader.** `get_document_content` returned `slice(0, 20000)` and `truncated: true` with no way to ask for the rest — 8% of a 240,000-char report. The agent said "it's truncated" out loud and had nowhere to go. Hand back `next_offset`, and a `find` that centres the window on a phrase. — 09-26
- **A PROMPT EXAMPLE IS TRAINING DATA, AND A STALE ONE IS A LIE THE MODEL REPEATS WITH CONFIDENCE.** A new rule listed "a spreadsheet" as permanently unreadable and gave the sample sentence *"the acreage is in Full Claim List.xlsx, which the platform cannot read yet"* — and the agent said exactly that about a file indexed an hour earlier in the same session. Never illustrate a rule with a limitation you are in the middle of removing. — 09-26
- **"No text" must say WHY, or it reads as a transient miss.** `has_full_text: false` with no reason had the agent re-fetching the same empty document twice in one turn. The distinction it needs is permanent-vs-transient: a scan and an unsupported file type will never answer, so the move is to name the file as a gap and work the other sources. — 09-26
- **`matchesPrefix` is NOT method-aware** — allowlisting a read path grants every mutation under it. Routes carry their own guards regardless. — 09-22
- **A record created with no owner is invisible under a default "mine" scope.** A lead promoted to steel landed with `salesperson_id` NULL against a board that defaults to filtering on exactly that column — created, correct, and in nobody's pipeline. Default the owner to whoever acted, and never let an unowned record be hideable: count it over the WHOLE set, outside the scope. — 09-24
- **A promotion that creates a record must carry everything the record's next button needs.** The steel deal's Quote button is gated by `quoteReadiness()`, and two of its blockers (site address, scope line) were sitting on the lead unread. Reporting success and then handing over a disabled button is the same failure one screen later. — 09-24
- **User-initiated mutations on tracked tables use `actorAdminClient()`**, not `createAdminClient()`, or the activity log says "system". — 07-03
- **Task owners and contacts are one person** — `team_members.party_id` ties them; adding or using an owner maintains the contact. — 07-21
- **New UI uses the Panel / Chip / `label-caps` idiom and `.elev-*`, never raw `shadow-*`.** No glassmorphism, no animated numbers, color only for status meaning. Date fields use `DatePicker`, never a native `<input type="date">`. — 07-17, 07-10
- **Two Claude sessions share this repo.** Stage files BY NAME, never `git add -A`, or you absorb the other session's in-flight work. Three recorded occurrences. — 09-23

---

## 13. BUILD STATUS

**Reality:** well beyond the original Phase 1/2 plan. Live and in daily use, **self-hosted on the Mac Studio** (`100.86.79.4`, Tailscale-only) against self-hosted Supabase under Colima, with AI served by LM Studio on the same machine. Vercel is no longer the runtime.

**Working:** projects (CRUD, pipeline/program views, hierarchy, all detail tabs), **land/parcels (a Land tab per project: county parcel schedule, deal-vs-assessor acreage, boundaries imported by parcel id from Utah AGRC — 2026-09-28)**, **interactive project map (/map — offline basemap, illustrated markers, rail corridors, parcel polygons, present mode)**, **task handoffs (waiting-on) + printable weekly report (/reports/weekly/print, per-person pages)**, **opportunities**, **investors (capital raise pipeline: relationship stages + per-deal commitments vs parent co / project SPVs; named raises w/ tranche schedules + per-raise dashboards; task tags, Ber AI tools + RAG, attention + daily-brief wiring)**, **objectives steering board (Now/Soon/Possibly + PDF export, wired into tasks/dashboard/brief)**, **steel CRM (/steel — prefab steel deal pipeline w/ its own `steel_sales` role, 2026-07-25; one-click quote generation from a Drive-hosted Google Doc template → PDF on the deal + in Drive, 2026-09-16)**, **dino (/dino — internal operating-company revenue tracker: internal-vs-external split + $150k payment schedule, admin-only, 2026-07-28)**, **Pepper — the assistant layer (2026-09-24: a per-person morning note by email at 06:50 weekdays, what you owe / are owed / your day / the queue, sent as *Pepper <info@berwilson.com>*; plus batch approval on `/decide`)**, dashboard (single attention surface, opens with Now objectives), timeline, **team tasks** (per-person workload, project/opportunity/objective tags), **one Directory (Contacts | Vendors tabs) + business-card scanner (photo → on-device OCR → researched contact; a whole stack at once via `/intake?tab=cards`, read in the background and reviewed once)**, company profile (thin), review queue, activity log, manual-paste extraction (action items → real tasks), intel (RAG + streaming agent) + **ambient Ask Ber AI dock (⌘J, every page)**, **one Intake destination (`/intake`: Email | People | Cards | Meeting | Proposal | Document tabs)** — including **People Intake (2026-09-24: a cast of names or addresses in → profiles read out of the stored mail, their employers linked, and everyone attached to a project or opportunity as players, on one confirm)** — proposal intake → assessment → project creation, and Email Intake (in-platform **Gmail** sweep → report → opportunity/project + people + tasks). **A meeting can also stage candidate deals as LEADS rather than records (2026-09-29) — the right shape for a site-selection or brokerage call that names a dozen properties; each is fit-scored overnight and promoted by hand, and a lead that turns out to belong to a record already on file can be ATTACHED to it instead of duplicating it.** **Calendar/meeting-prep and mail both run on Google Workspace via per-mailbox OAuth (Microsoft Graph removed 2026-08-23); the email-to-task scraper was removed (see below).** Equity & Portfolio modules removed 2026-07-03 (see below).

**Full history: [`docs/BUILD-LOG.md`](docs/BUILD-LOG.md)** — 120 dated entries, 2026-06-22 → 2026-09-24, carrying the reasoning, the measurements and the verification behind every decision. Not auto-loaded into a session; grep it when you need the "why" (*"why is the digest at 7:00am?"*, *"have we hit this bug before?"*).

### Open items (Richard)

Env vars re-checked against `.env.local` on 2026-09-23. Everything else is **as last reported on its date, not re-verified** — confirm against the live system before acting on it.

| Item | Raised | State |
|---|---|---|
| `GOOGLE_DEAL_INTAKE_FOLDER_ID` unset → deal intake off, its cron 503s | 09-05 | **verified still empty** |
| `DINO_LEAD_EMAIL` unset → the Dino forward button 400s | 08-26 | **verified absent** |
| 27 opportunity documents never indexed (the Englert / Gold mine M&A file) — run `node --experimental-strip-types --import ./deploy/register.mjs --env-file=.env.local scripts/reindex-opportunity-documents.mts` | 09-22 | as reported |
| 4 staged intake sessions cannot be accepted until a name is typed — *LOI*, *Text*, *Due Diligence Letter*, *Energy Development Group* | 09-23 | **re-measured 09-24: still exactly 4** (2 need a project name, 2 an opportunity name); batch approval still cannot take them. **Since 09-30 there is a second way through: send the package to an existing record instead** — a name is only required to CREATE one |
| **An email intake package can now be sent to a project or opportunity that already exists** — open it from `/intake`, choose **Existing record**, and search or click one of Ber AI's matched chips. Everything the run assembled goes onto that record (report as an update + document, people as players, tasks, checked attachments) and the conversation is linked so later replies post there. Blank columns are filled from the mail; nothing already set is overwritten and the record is never renamed. This is the fix for several proposals arriving for one deal — the queue proposes one per CLUSTER of correspondence, not one per deal | 09-30 | **new — worth using on the Myton/data-centre/GridEdge duplicates** |
| iOS caches home-screen icons hard — remove the shortcut and re-add from Safari to pick up the new logo | 09-23 | as reported |
| Commitment backlog (~1000 threads) drains over a day or two through the hourly sweep; the health card stays amber until it does — the test is whether the number FALLS | 09-23 | self-resolving |
| One team member has no Google Tasks mailbox configured | 09-23 | as reported |
| `deploy/backup.sh` and `~/supabase-selfhost/backup.sh` are synced BY HAND — copy across after editing either | 09-23 | standing |
| 3 senders could not be auto-unsubscribed (officedepot, jooble, mccleerycompany); 5 professional bodies were spammed but deliberately not unsubscribed | 09-22 | optional |
| One test message remains in `moose@` ("Ber Intelligence self-loop verification") — the platform cannot delete it, by design | 09-22 | cosmetic |
| `npm run gen-types` is a disabled stub and `SUPABASE_DB_URL` is read by nothing, so the generated types are frozen and six live tables are missing from them — repairing it against the self-hosted DB is a small un-done job (§4 now says so) | 09-24 | as reported |
| **One People Intake session is staged and un-confirmed** at `/intake?tab=people` — Seth Lloyd and Trevor Burton ready to save. Attaching them to the existing **Elite Solutions** opportunity is one dropdown; there is still no Eagle Mountain record, and the Attach picker creates nothing, so make that record first if the cast should land there | 09-24 | **action** |
| **Pepper's morning note is live and sends weekday mornings at 06:50** to every active team member with an email, excluding the `info@` seat itself. Richard has received two (verified read back out of the mailbox); **Eric has not yet received one** — his first arrives at 06:50 on the next weekday. Reply-to-Pepper does not exist yet, so replying to the note reaches nobody | 09-24 | **heads-up** |
| **The `/decide` backlog can now be cleared in one sitting** — "Select the N Ber AI is sure about" ticks the 77 accept-ready staged sessions (of 81; all at confidence ≥0.85) and accepts them one at a time. Nothing was accepted on your behalf; the queue is exactly as it was | 09-24 | **action** |
| **~148 attachments are backfilling onto records** — every link's `attachments_through` starts at 0, so the hourly apply pass now imports the documents that were unreachable before. Each costs a local document AI pass (~30s), budgeted at 10 min/run, so it drains over a day or two. Nothing is announced (backlog, not news) | 09-25 | self-resolving |
| ~~Scanned documents are the largest blind spot~~ **RESOLVED 2026-09-26 with Apple Vision OCR, no model required.** 324 of 340 live documents now hold text (was 292). The remaining 16: **6 genuinely blank or purely graphical** (`Resistivity-EM 56 kHz.pdf`, `TiltMin_Worm…pdf`, `freegoldmap.jpg`, two `noname` images), **9 calendar/raw-email files** that carry no document text by design, and **1 password-protected PDF — `SNL_Letter_Englert_Results.pdf`**, which needs its password to ever be read | 09-25 → 09-26 | **resolved; 1 encrypted file outstanding** |
| **DONE 2026-09-26: the window is 131,072 with a q8_0 K/V cache**, and `.env.local` sets `AGENT_CONTEXT_BUDGET_CHARS=300000` / `AGENT_DOC_WINDOW_CHARS=40000` to match. ⚠ **Two things to re-check after ANY eject/reload in LM Studio**, both seen live on this change: a model id ending `:2` in `lms ps` means a second 22GB copy is resident (41GB against 36GB of RAM), and `--parallel` reverts to 4. Cost measured: document summary latency roughly tripled (40-50s → 110-135s) on the long OCR'd records, which is the doubled window's prompt-processing price | 09-26 | **done — verify `lms ps` after a reload** |
| **The apply phase has no concurrency guard** — a manual run and the hourly cron can both post the same email. Pre-existing: 15 `source_ref` groups in `updates` hold duplicates, dating to 2026-05-04. Today's three were removed. The correct fix (claim-then-post) trades a duplicate for a possible loss, so it wants its own pass | 09-25 | as reported |
| **80 of 83 contacts are still without a photo, and the blocker is the Gemini free tier — 20 requests a day.** The backfill filed 3 logos with no model call at all and then stopped cleanly at the wall. Two ways forward: **enable billing on `GEMINI_API_KEY`** (pay-as-you-go flash is cents for this whole directory, and it also unblocks Enrich Profile, which is capped at ~5 contacts a day today), or re-run `node --experimental-strip-types --import ./deploy/register.mjs --env-file=.env.local scripts/backfill-profile-photos.mts` on successive days. Re-running is free and skips anyone who already has a photo | 09-27 | **action — needs a billing decision** |
| **Three IBC Building Code PDFs exceed the 30MB knowledge-base ceiling** (`IBC Building Code 2024.pdf` + two redline sets) and are the only real content still absent from the Drive knowledge base. `MAX_FILE_BYTES` in `src/lib/knowledge/drive-sync.ts`. Raising it on a 36GB box that already swaps is a judgement call, not a cleanup — a code manual is also reference material the agent rarely needs verbatim. The nightly log now names them rather than hiding them in a `skipped` count | 09-27 | **decision needed** |
| **`/contacts` is the densest remaining scanning problem** — 80 records in ~290px portrait cards, six to a screen, with a centred 80px avatar over ragged content and some cards rendering an `<hr>` with nothing beneath it. A horizontal row (~72px) plus a list-view toggle would put 4–5× more on screen. Designed, not built | 09-26 | **next** |
| **The field kit exists but only five forms use it** — `src/components/ui/field.tsx` + `src/lib/utils/field-classes.ts` are in place and `ProjectForm`/`OpportunityForm`/`ContactForm`/`InvestorForm`/`SteelDealForm` import the shared strings. The remaining a11y debt is **101 unassociated labels in 22 files**, with 62 of them in six: `InvestmentsSection` (18), `MeetingForm` (13), `RaiseForm` (11), `ProposalIntakeWizard` (7), `UserAccessManager` (7), `RevenueLedger` (6). One file per commit; promote `label-has-associated-control` to `error` when they are clear | 09-26 | as reported |
| **Delta's parcel schedule disagrees with the county on one parcel** — the rezone application states HD-5534-A-1 at 13.00 acres; Millard County records 4.69. Exhibit total 928.98 vs cadastral 920.67. Worth resolving with the recorder before the figure goes into an application or a purchase price | 09-28 | **decision needed** |
| **The Heber project has no coordinates and is not on the map** — its site plan is an unlabelled concept pad layout with no legend, no dimensions and no survey basis, so pad uses and acreages are not on file. Place it from the Place Projects panel on `/map`, and ask the originator for the legend sheet | 09-28 | **action** |
| **Both site plans were photographed, not exported** — Delta's exhibit is marked *Sheet 1 of 2* and sheet 2 is not on file. The source PDFs from JLD Development would read with no OCR at all, and would supersede the photos | 09-28 | **action** |
| **The two site-plan images are filed with hand-written summaries and no extracted text** — the OCR pass was deliberately not run (the model was generating with swap at 12.3 of 13.3GB; §12 forbids OCR alongside the LLM). Re-run the document AI pass on them in a quiet window to make their printed text searchable | 09-28 | as reported |
| ~~`lms ps` shows `PARALLEL 4` again after an LM Studio reload~~ **RESOLVED 2026-09-30.** The model was reloaded at `-c 131072 --parallel 1`, `131072` was written into LM Studio's persisted load config, and **`zsh deploy/lmstudio-check.sh` now asserts context, parallel, both models and a duplicate `:2` copy on every deploy** — the drift is caught rather than remembered. (Measured on the way: `--parallel` is not a memory lever, but context is — the box had drifted to 173,824, costing +1.38 GiB it did not have) | 09-28 → 09-30 | **resolved** |
| **THREE Meet sessions are staged and un-confirmed** at `/intake?tab=meeting`, not one — filing a meeting's DOCUMENT and confirming its SESSION are different acts, and the two Elite Solutions calls did only the first (transcripts indexed onto the opportunity, 43 + 28 chunks; their minutes, tasks and attendees are still waiting). The third, *Ber Wilson/Rebecca/Merlin Portfolio Review*, names *Steelton Project*, *Texas Greenfield Sites*, *Riverdale Site* and *West Virginia Portfolio*, **none of which exist as records** — as of 09-29 each is one click to **stage as lead**, which is the intended path for a portfolio call. **Keep titling calls with the deal name** (`Ber Wilson/TensorIQ/Elite Solutions`) — the last meaningful segment is the filing key; a call with no single deal (`Ber Wilson/Rebecca Merlin/Portfolio Review`) fans out, and that fan-out IS the signal to route to leads. Dry-run any time with `node --experimental-strip-types --import ./deploy/register.mjs --env-file=.env.local scripts/verify-meet-import.mts` | 09-28 → 09-29 | **action** |
| **Rebecca has ~25 more sites to show.** The path is now: record the call in Meet with a title that names her rather than a deal, let the import stage it, then stage each site as a lead from the review screen. They arrive unscored (no bid date, no fit score) and the nightly score phase fit-assesses them against the pursuit profile — so the queue is worth re-reading the morning after, not the same hour. Promote the few that earn it; attach any that turn out to be a site already on file. | 09-29 | **heads-up** |
| **`opportunities.drive_source_folder_id` and `steel_deals.drive_source_folder_id` have no importer** — the columns exist and nothing reads them, so dragging a file into an opportunity's Drive folder does nothing. Projects are fine (`importDriveFolder` + `syncProjectFolders`, hourly). Meet notes route around this rather than closing it | 09-28 | as reported |
| **Sign in as `moose@berwilson.com`, not `info@`** — info@ is now the "Pepper Potts" seat for a future executive assistant, so logging in there greets you as her with an empty task list. Both remain working admin logins; nothing was deactivated. `/settings/users` parks the seat in one toggle when you want it held | 09-24 | **action** |
| **A cross-encoder reranker is the next real retrieval accuracy gain, and LM Studio cannot serve one yet.** Hybrid retrieval currently re-ranks by recency/confidence/cosine — a heuristic over the embedding's own similarity. A reranker (e.g. Qwen3-Reranker-0.6B) reads the query and passage together and is markedly better at exactly the "which of these forty passages actually answers this" step, for ~600MB and no re-embed. **LM Studio has not implemented a rerank endpoint** (`LmStudioRerank has not been implement`), so this is a revisit-when-it-ships, not a task | 09-30 | **blocked upstream** |
| **The 4B embedder would measurably improve retrieval and there is no RAM for it on this box.** `Qwen3-Embedding-4B` scores **69.45 MTEB multilingual against the 0.6B's 64.33**, and it must stay resident beside 22GB of chat weights on a 36GB machine that was at 314MB free. It is a reason to want a bigger Studio, not a change to make on this one. If the box is ever upgraded, this plus the reranker are the two retrieval levers, and both mean a full `deploy/reembed.mjs` run | 09-30 | **wants more RAM** |
| ~~`git push` failing 403 — no off-box backup~~ **RESOLVED 2026-09-30.** The stored credential was a different GitHub account (`richmwhite1`) from the one with write access; Richard reconnected GitHub and `7ca63f3..6a47c8d` pushed clean, `origin/main` now matching local. Worth remembering the shape: a push 403 does NOT stop a deploy here, because the Studio IS production and pushing is backup only — so the repo can quietly stop being backed up while everything looks healthy | 09-30 | **resolved** |

`GOOGLE_CHAT_WEBHOOK_URL` is now **set**, so the 09-23 manual step is done — but if you created a dedicated "Ber Wilson Updates" space, confirm it points there rather than at the old room.

### Highest-leverage next work

1. **Give Pepper ears** — email `info@` a question from a phone and have her answer in-thread over the agent's 42 read-only tools, sender-allowlisted to the two executive addresses. `info@` is already swept nightly and is the one mailbox that can send; the parts are almost all built. This is the single most assistant-like thing left.
2. **Drain the overnight backlog** — **1,333 of 2,442 threads have never had the commitments pass** and 841 are unembedded, against an engine that is ~95% idle and completely free 19:00–04:00. Finishing existing passes, *not* inventing new ones, and checkpointing after each unit (a deploy is a `kickstart`, §12).
3. **The chase list** — 107 commitments are owed *to* us. Draft the chase in `info@` as an unsent draft, exactly as `leads/draft-reply.ts` already does.
4. **Fill the project-value bounds** on `/company` (`min_project_value`, `sweet_spot_value`, `max_project_value`) — the last real gap in the pursuit profile, which is otherwise well populated as of 2026-09-24. Everything else that line used to list is done.
5. Optionally persist `fit_assessment` on `proposal_intake_sessions` (currently returned in the intake response but not stored).
6. Tend the known debt in §9 as it gets in the way.

### Recent sessions

Newest first; full entries in `docs/BUILD-LOG.md`.

- **09-30** — an intake package can be sent to the project it is already about, and merging stopped throwing the run away (DEPLOYED)
- **09-30** — a quarter of every vector was being thrown away, and the re-embed tool that would have caught it could not run (DEPLOYED + MIGRATED)
- **09-29** — a broker names a dozen sites in an hour: meetings stage candidate deals as leads, and a lead can attach to the record it already belongs to (DEPLOYED + MIGRATED)
- **09-29** — Ber AI stopped mid-thought on the best-evidenced questions: a 300s ceiling inside `fetch` that no setting could reach (DEPLOYED)
- **09-28** — a site plan that is not a picture: Delta's 929 acres loaded by parcel number from the county's own GIS; /map draws land (DEPLOYED + MIGRATED)
- **09-28** — Meet recordings reached nothing for 192 runs: a folder renamed, a subfolder added, a note it could not recognise (DEPLOYED)
- **09-27** — Ber Intelligence could not read a deck, a phrase, or past a hex dump; the stream stall was one timeout doing two jobs (DEPLOYED)
- **09-27** — contact photos found on the open web: a bio page beats LinkedIn, and three of four obvious sources are dead (DEPLOYED)
- **09-26** — scanned documents read by Apple Vision OCR (a lease's 665 acres, in 3 seconds); agent limits lifted to 30 rounds / 30 min (DEPLOYED)
- **09-26** — Ber AI announced a search and then stopped: a five-round cliff with no answer behind it; spreadsheets now readable (DEPLOYED)
- **09-26** — UX/UI pass: the brief renders as a brief, the Decide queue reads as facts, one attention number (DEPLOYED)
- **09-25** — a title company's documents reached nothing; the attachment importer could never have run (DEPLOYED + MIGRATED)
- **09-24** — a lead promoted to the Steel CRM disappeared: created, correct, and in nobody's pipeline (DEPLOYED)
- **09-24** — Pepper: a morning note addressed to a person, and one stack to approve (DEPLOYED)
- **09-24** — a stack of business cards, scanned at once and reviewed once; the scanner finally asks whether it already has the person (DEPLOYED + MIGRATED)
- **09-24** — People Intake: enter a cast, get their profiles out of the mail already on file, attach them to the deal (DEPLOYED + MIGRATED)
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
