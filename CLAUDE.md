# BER WILSON — Executive Intelligence Platform
# Master Architecture & Build Reference (CLAUDE.md)
# Version: 2.0 | 2026-06-22

---

## WHAT THIS FILE IS

Canonical reference for every Claude Code session working on the Ber Wilson platform. Lives in the project root as `CLAUDE.md`; Claude Code reads it automatically.

**Builder:** Richard (EVP, Ber Wilson) — builds in Claude Code terminal. Not a developer.
**Golden rule:** Never introduce complexity without demonstrated need. Every decision reversible or portable.

> **Version 2.0 note:** This file was rewritten on 2026-06-22 to match the code as it actually is. The v1.0 reference described a Claude-Haiku/Sonnet app that no longer exists — runtime AI is now **Google Gemini**. If anything below disagrees with the code, the code wins; fix this file.

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

**The platform is fully self-hosted and fully local-AI as of the 2026-07-07 cutover** (Richard's decision: absolute security, nothing leaves his hardware). Production = the Mac Studio, tailnet-only: app at `https://richards-mac-studio.tail0e5306.ts.net/`, self-hosted Supabase at `:8443`, LM Studio on localhost:1234.

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
- **Directory:** `parties` (people + orgs via `is_organization`), `contact_aliases`, `entities` (legal entities/vendors), `entity_projects`, `party_entities`, `certifications`.
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
- TypeScript strict mode. Avoid `any` — the codebase has ~23 remaining `any`/cast escapes from schema drift (down from ~115; recount 2026-07-05); don't add more, and prefer regenerating types over casting.
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
MICROSOFT_TENANT_ID=             # Graph OAuth (calendar, enrichment, email research)
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_WEBHOOK_SECRET=
CRON_SECRET=                     # Bearer auth on cron routes; launchd cron agents on the Studio send it
MAP_PMTILES_PATH=                # optional; /map basemap archive (default ~/berwilson-data/maps/us.pmtiles)
```
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
- **Type drift.** Generated types lag the schema; recurring inline casts (`project as { … }`). Regenerate and fix.
- ~~Speculative early-build features~~ **RESOLVED 2026-07-03:** Procore stub, background checks, and vendor scorecards/reviews removed. Party/entity enrichment (Gemini research) is real and stays.
- ~~Legacy `action_items`~~ **FULLY RETIRED 2026-07-03.** Reads moved to the `tasks` table earlier (via `src/lib/tasks/queries.ts`); writes stopped 2026-07-03 — manual-paste extraction creates real tasks at save time (`src/lib/tasks/from-action-items.ts`) and review-queue approval converts legacy pending items. `20260704000004_drop_action_items.sql` drops the column (code shipped first; dual-schema safe). The extraction *prompt* still returns `action_items` JSON — that's the contract feeding task creation, not schema debt. Old email-era tables `processed_emails`/`graph_subscriptions` and `updates.outlook_web_link` are dropped by `20260704000001_simplification_drops.sql`.
- **Pre-existing lint noise (recount 2026-07-05, after the lint-debt pass):** two `react-hooks/purity` errors in `src/app/dashboard/page.tsx` (`Date.now()` in a server component — rule misfire, runtime fine); 13 `react-hooks/set-state-in-effect` errors (load-on-mount fetch / localStorage hydration / sync-form-on-modal-open patterns — each needs a per-component rewrite to satisfy the React Compiler; deliberately left, they work); 6 `@next/next/no-img-element` warnings (Supabase Storage images — switching to `next/image` needs `remotePatterns` config; do it if image cost/LCP ever matters). Everything else was cleaned 2026-07-05 (76 → 21 problems).
- **`team_members` is a 4th people-concept** (alongside parties/entities/stakeholders), deliberately kept tiny and separate so task assignment stays fast. If the team-vs-contact overlap ever matters, reconcile with `parties`.

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
- Re-add the **automatic** email-to-task scraper — the webhook-subscription pipeline that silently turned inbox mail into records was deliberately removed 2026-06-25 and stays removed. The on-demand `/email-research` flow (2026-07-02) is different and allowed: a human triggers a mailbox search, and nothing is created without the human review/confirm step in Email Ingestion.

---

## 12. BUILD STATUS

**Reality:** well beyond the original Phase 1/2 plan. Live and in daily use on Vercel production.

**Working:** projects (CRUD, pipeline/program views, hierarchy, all detail tabs), **interactive project map (/map — offline basemap, illustrated markers, rail corridors, present mode)**, **opportunities**, **objectives steering board (Now/Soon/Possibly + PDF export, wired into tasks/dashboard/brief)**, dashboard (single attention surface, opens with Now objectives), timeline, **team tasks** (per-person workload, project/opportunity/objective tags), **one Directory (Contacts | Vendors tabs)**, company profile (thin), review queue, activity log, manual-paste extraction (action items → real tasks), intel (RAG + streaming agent) + **ambient Ask Ber AI dock (⌘J, every page)**, proposal intake → assessment → project creation, **Email Intake** (in-platform Outlook sweep → report → opportunity/project + people + tasks). **Calendar/meeting-prep still uses Microsoft Graph (OAuth retained); the email-to-task scraper was removed (see below).** Equity & Portfolio modules removed 2026-07-03 (see below).

**Done 2026-07-09 (map completion pass — the full idea list is DONE and DEPLOYED):**
- **Marker clustering:** screen-space greedy grouping (48px radius) below zoom 14 — overlapping markers merge into a count puck (sector-colored when all one sector, slate otherwise; sized by count), click fits the cluster's bounds. Recomputed on `moveend` + data/selection changes in `MapView.refreshClusters`; hidden members get `display:none` (markers aren't destroyed). The **selected project never clusters**, so tour/selection highlights survive; above zoom 14 nothing clusters (same-address escape hatch).
- **Awarded vs Pipeline:** `projectPhase(stage)` in `src/lib/map/constants.ts` (award/mobilization/execution/closeout = awarded; pursuit/capture/bid = pipeline). Toolbar segmented filter (All | Awarded | Pipeline) composes with sector chips; stats + tour follow. **Markers distinguish phase visually: awarded = solid sector puck, pipeline = outlined** (bg-card, sector ring + glyph via `SECTOR_OUTLINE`).
- **Value-scaled markers:** three tiers — <$20M small (size-7), $20M–$250M / unknown mid (size-9), ≥$250M large (size-11). Tier+phase stamped as `data-variant` (`markerVariant()`) so MapView's diff rebuilds stale elements.
- **Deep links:** `/map?project=<id>` (server page reads searchParams → `initialProjectId`; client validates + selects on mount, camera flies in). Project detail header (`projects/[id]/layout.tsx`) gains an admin-only **"View on map"** chip when the project has coords or a route.
- **On-map search:** `MapSearch.tsx` in the toolbar — type-ahead over **visible** (filtered) projects by name/location/client, ↑/↓/Enter or click flies to the pick. mousedown-not-click on rows (beats input blur).
- **Present-mode route animation:** ant-path dash-flow on rail corridors (`project-lines-dash` white overlay layer; 14-frame `DASH_SEQUENCE` cycled ~80ms via rAF — maplibre can't interpolate dasharray). Present-mode only, honors `prefers-reduced-motion`, visibility restored across style reloads via `animateRef` in `ensureOverlays`.
- **Photo lightbox:** sheet photos click to a portaled fullscreen viewer (arrows/Esc/counter; `createPortal` to body because SheetContent's transform would trap `position:fixed`). Esc/outside-click close only the lightbox (guarded in Sheet `onOpenChange`); the tour's key handler pauses while it's open (`onLightboxChange` → `photoLightbox` gate) and skips INPUT/TEXTAREA targets so the search box works in present mode.
- All verified: `tsc` + eslint + full build clean; deployed to the Studio (health 200; `/map` 307 unauthed, tile route 401 unauthed — both correct). **The map idea list is fully shipped**; remaining map work is Richard's data entry (place projects, draw corridors).

**Done 2026-07-09 (map presentation layer — tour, labels, stats; DEPLOYED):**
- **Present-mode portfolio tour:** in Present mode, ←/→ (also PageUp/PageDown, or the on-screen ‹ › bar bottom-center) step through placed projects **biggest value first**, flying to each and opening its sheet — the "replaces the slide deck" flow. Keyboard listener is capture-phase so the maplibre canvas doesn't also pan; wraps around; respects sector filters (tour = `visible`). Placement panel now hidden while presenting.
- **Marker labels:** styled name+value label above each puck — on hover always (with `hover:z-10` so it isn't buried under siblings), persistent for ALL markers past zoom 9. Mechanism: MapView toggles `data-map-labels` on the container (named group `maplabels`); markers use `group-data-[map-labels=true]/maplabels:opacity-100` (verified emitted in built CSS — Tailwind does scan the JS template strings in markers.tsx). Project names are HTML-escaped (`escapeHtml`) — they go through innerHTML.
- **Live stats readout** replacing the "N on map" chip: visible count · total pipeline · weighted value (reuses `formatValue`/`weightedValue`), updates with sector filters — filter to a sector and present "just our government work, $X".
- ~~Remaining from the agreed map idea list~~ — **all shipped later the same day** (see the completion pass above). Deliberately skipped: 3D terrain, heatmaps, time sliders.
- Housekeeping: deleted stale `.next/types/* 2.ts` Finder-duplicate files that broke `tsc` (build artifacts, regenerate). `tsc` + eslint + full build clean; committed, pushed, deployed to the Studio (health 200, /map 307s unauthed over tailnet).

**Done 2026-07-09 (interactive project map — /map):**
- **New top-level area `/map`** (primary nav, mobile More, ⌘K "Project Map", header title): a presentation-grade interactive map of the whole portfolio — Richard's alternative to slide decks. Opens on Utah (US-wide basemap underneath for the nationwide future), illustrated sector-tinted markers per project type (`map_icon`: data_center/rail/hospital/housing/power/industrial/government/office/water/default, sector-derived fallback), click → eased flyTo + right slide-over detail sheet (photos from `media`, sector/stage/status chips, value + weighted value, client/location/delivery, description, key dates, "Open project" link). Rail corridors render as sector-colored glowing lines (`map_geometry` GeoJSON LineString), clickable like markers. Sector legend chips filter; Present mode = chrome-hiding fullscreen overlay for stakeholder demos. **Admin-only by default** (deliberately not in `permissions.ts` allowlists; a comment there explains how to open it to PMs later).
- **Fully offline basemap — zero external requests at view time.** MapLibre GL JS + Protomaps `.pmtiles` served by new `GET /api/map/tiles` (fs byte-range streaming; 206/416 semantics unit-tested incl. pmtiles magic bytes; missing archive → 503 with a setup hint, surfaced in the map UI). Archive at `~/berwilson-data/maps/us.pmtiles` **outside the app dir** (survives the deploy rsync `--delete`); override `MAP_PMTILES_PATH`. **The Studio holds the full-depth continental-US extract (17GB, zoom 0-15, extracted on the Studio itself 2026-07-09 — go-pmtiles binary at `~/.local/bin/pmtiles` there); the MacBook keeps a small Utah extract (275MB) for local dev** (`scripts/setup-map-data.sh`, `SCOPE=utah|conus`). The deploy script pushes the archive **only if the Studio has none** and never overwrites — basemap upgrades are a manual re-extract on the Studio (`deploy/README.md` has the command). Style built in code (`src/lib/map/style.ts`, `@protomaps/basemaps` layers, light/dark flavors — follows the app's dark-mode toggle live via a MutationObserver on `<html>`); fonts/sprites vendored to `public/basemaps/` (gitignored; the deploy rsync ships the working tree). New deps: `maplibre-gl`, `pmtiles`, `@protomaps/basemaps` (rendering libs only — §11 intact); maplibre is SSR-firewalled behind `next/dynamic ssr:false` and stays in the /map chunk.
- **Placement is hand-done on the map** (no geocoding): migration `20260709000001_project_map.sql` (**APPLIED to the Studio DB**, PostgREST restarted — it caches the schema) adds `projects.latitude/longitude` (range-checked) + `map_icon` + `map_geometry`; `database.ts` hand-extended. PlacementPanel (admin) lists unplaced projects with free-text `location` as the hint → click the map to place ("N of X placed" progress); the sheet has Reposition / Draw route (click vertices, Enter or double-click finishes, Esc cancels) / Remove route / marker-style picker. Writes reuse `PATCH /api/projects/[id]` per-field pattern (map fields admin-gated; LineString validated + 100KB cap; returning columns only include map fields when touched, so existing callers are unchanged). Optimistic UI + `router.refresh()`.
- **Components:** `src/components/map/` (MapPageClient orchestrator, MapView raw-maplibre wrapper — no react-map-gl, ProjectMapSheet, PlacementPanel, markers.tsx illustrated SVG pins on the SECTOR_BADGE hue families) + `src/lib/map/` (constants, types, style). Server page clones the projects-page pattern (admin-client fetch → client props; media public URLs computed server-side).
- **gen-types gotcha (post-cutover):** `npm run gen-types` still targets the paused cloud project (`--linked`), and `--db-url` needs a local Docker daemon the MacBook doesn't have. Workaround: run `npx supabase gen types --db-url postgresql://postgres:<pw>@localhost:5432/postgres` **on the Studio** (Colima) — but that output drops the `storage`/`graphql_public` blocks the committed file carries, so `database.ts` was hand-extended instead (the practiced pattern). Fix the script when it next matters.
- **DEPLOYED + verified end-to-end on production:** tile route 13/13 range-semantics checks; magic-link login → `/map` 200 authed / 307 unauthed **over the tailnet URL**; tiles 206 with PMTiles magic bytes from the full-US archive; PATCH place/revert, validation rejects (bad lat/icon/geometry), and LineString round-trip confirmed against the Studio DB; both style flavors pass the maplibre style-spec validator and every referenced font is vendored. `tsc` + eslint + full `next build` clean. **Remaining for Richard: place the ~97 projects** (Place Projects panel, bottom-left of /map — each row shows the free-text location as a hint) and draw the rail corridors (Draw route in a project's sheet).

**Done 2026-07-07 (CUTOVER COMPLETE — the platform is fully local; steps 3+5 done):**
- **Final migration executed:** fresh cloud→local dump/restore + 56/56 file re-sync; **every one of the 38 public tables verified count-identical to cloud**, auth (users/identities/sessions) and storage timestamps match exactly. Two migration subtleties handled: auth/storage truncate+restore must run as `supabase_admin` (not `postgres`), and `TRUNCATE auth.users CASCADE` reaches `public.media` via FK (repaired from a targeted dump; it was the only affected table — verified).
- **Studio app now points at local Supabase** (`https://richards-mac-studio.tail0e5306.ts.net:8443` via a second `tailscale serve` listener → kong :8000); rebuilt (NEXT_PUBLIC_* are build-time) + service restarted, HTTP 200. MacBook `.env.local` flipped too — local dev also targets the Studio stack.
- **Step 3 (re-embed) done:** chunks wiped and regenerated with the local embedding model — **213 chunks** (was 124: all 46 updates now embedded vs 3 historically, 14/16 documents (2 had no extractable text), opportunity snapshot + note). Gotchas hit: PostgREST schema cache goes stale after `DROP SCHEMA public` (restart `supabase-rest` after restores) and documents' summary column is `ai_summary`. Tooling preserved: `deploy/reembed.mjs` + `deploy/alias-loader.mjs` (runs repo lib code standalone: `node --experimental-strip-types --import ...register(alias-loader)... --env-file=.env.local <script>`).
- **Verified fully local end-to-end:** `embedQuery`→`match_chunks` returns real content; full `runAgent` loop (tool call → grounded answer, 6.9s) against the local stack; cron route auth OK (tomorrow 6:30am generates the first fully-local brief).
- **Step 5 (decommission) done:** cloud Supabase project **paused** via Management API (data retained — the rollback safety net; restore from the Supabase dashboard if ever needed), **Vercel project `berwilson-platform` deleted** (deployments + env vars gone; all values live on the Studio + MacBook env files). **`git push` no longer deploys** — it's GitHub backup only; deploying = `zsh deploy/deploy-to-studio.sh`.
- **Manual items for Richard:** (1) revoke the Gemini API key in Google AI Studio — zero Gemini traffic remains (or keep it and set `LOCAL_ALLOW_WEB_RESEARCH=true` if vendor-enrichment web research is wanted); (2) when reconnecting Microsoft 365 from the new origin, add `https://richards-mac-studio.tail0e5306.ts.net/api/email/oauth/callback` to the Azure app's redirect URIs (existing Graph tokens migrated and keep refreshing server-side); (3) Eric's devices need Tailscale to reach the platform; (4) offsite backup target still pending (enable SSH on the Mac mini).

**Done 2026-07-08 (documents open/view/download again — post-cutover storage repair):**
- **Every document download in the app had been broken since cutover — two stacked causes, both fixed.** (1) All three document surfaces (projects DocumentsTab, VendorDocuments, OpportunityDocuments) created signed URLs **browser-side with the anon key**; the self-hosted storage has **zero storage RLS policies** (they don't survive a data-only dump/restore), so every request died with "Object not found". (2) Even server-side signing would have 500'd: the final cutover restored `storage.objects` metadata from cloud (cloud version UUIDs) *after* the file re-sync had written disk files under locally-generated version UUIDs — all 56 migrated objects pointed at nonexistent disk paths (`ENOENT` on `/var/lib/storage/stub/stub/<bucket>/<name>/<version>`).
- **Code fix: signed URLs are now minted server-side** (admin client, behind auth + viewer role checks — consistent with §8's "middleware is the boundary"): new `GET /api/documents/[id]` and `GET /api/opportunities/documents/[id]` return `{url}` (300s expiry; `?download=1` adds attachment disposition). Shared client helpers in `src/lib/utils/document-links.ts` (`viewDocument`/`downloadDocument`; popup-blocker-safe pre-open). **Filenames are now clickable → PDFs/images/text open inline in a new tab; non-viewable types (docx…) fall back to download.** The Download icon forces a download. **Rule: never use browser-side `createSignedUrl` against this stack — it cannot work.**
- **Data fix on the Studio (one-time):** `storage.objects.version` realigned to the actual on-disk version for all 56 mismatched objects (deterministic — every object dir held exactly one file; audited 57/57 across documents/media/avatars, zero missing/orphans). Verified live: inline view + forced download + public media + a fresh same-day upload all HTTP 200. **RESTORE GOTCHA for the runbook: after any `storage.objects` restore, metadata `version` must match the on-disk file name — re-sync files AFTER restoring metadata, or realign versions like this pass did.**
- AI summaries were already stored/rendered per document (`ai_summary` under each row) — unchanged. `tsc` + eslint clean; deployed to the Studio and verified (new route 401s unauthenticated, health check 200).

**Done 2026-07-07 (security hardening pass — post-cutover audit):**
- **Live audit of the Studio's posture.** Confirmed already-good: FileVault ON, application firewall ON, no auto-login, no public Tailscale Funnel, no default Supabase creds, dashboard password strong (24 char), all secret files `600`, only 3 real users.
- **CRITICAL FIX — self-signup closed.** Self-hosted Supabase had `DISABLE_SIGNUP=false` + `ENABLE_EMAIL_AUTOCONFIRM=true`, and every RLS policy grants full access to any `authenticated` role (`auth.role() = 'authenticated'`, `WITH CHECK true`). Combined, anyone reaching the tailnet-exposed Supabase API on `:8443` could self-register (auto-confirmed) and read/write the **entire** database, bypassing the Next.js middleware (which only guards the app UI, not the API front door). Fixed: `GOTRUE_DISABLE_SIGNUP=true` in `~/supabase-selfhost/docker/.env` (backup `.env.bak-presec-20260707`) + recreated the `supabase-auth` container. Verified signup now returns `signup_disabled`; existing logins unaffected. **New users are added by admin invite only.**
- **Offsite encrypted backup wired (item awaiting one manual step).** `~/supabase-selfhost/backup.sh` (backup `.bak-presec-20260707`) now, after the local `pg_dumpall` + storage tarball, `age`-encrypts both artifacts and pushes them to the Mac mini (`richardwhite@100.74.2.126:Backups/berwilson-offsite`, 14-day retention). **The age PRIVATE key lives ONLY on Richard's MacBook** (`~/.config/age/berwilson-offsite-backup.key`, mode 600) — never on the Studio — so a stolen Studio or mini can't decrypt. Public recipient `age1q85gt646wmguldvruj8xfq25vmc0asj7js4xn67095ykqd9mzqsq4j7zc2` is embedded in the script. `age` installed on both machines (Studio: no-sudo binary in `~/.local/bin`; MacBook: brew). The offsite block is **non-fatal** — a mini outage or missing key just logs `WARN`, local backup always completes (verified: local ok, offsite warned gracefully, no stray `.age`).
- **Tailscale ACL policy drafted** at `deploy/security/tailscale-acl.hujson` (version-controlled copy; the live policy lives in the Tailscale admin console). Currently EVERY tailnet device can reach EVERY Studio port (5432 Postgres, 1234 LM Studio [no auth], 5900 Screen Sharing, 22 SSH, 8000/8443 Supabase). The policy keeps Richard's devices (`group:admins`) full-access and scopes any future non-admin device (Eric, PMs) to only 443 + 8443. Studio left user-owned (untagged) so the backup push is already permitted by the admin rule. Includes an ACL `tests` block that guarantees it can't lock Richard out.
- **Deferred by Richard:** SSH key-only auth (disable `PasswordAuthentication`) — low value while tailnet-only; not applied.
- **Two manual steps remain for Richard:** (1) paste `deploy/security/tailscale-acl.hujson` into https://login.tailscale.com/admin/acls; (2) authorize the Studio's SSH key on the mini so the offsite push works — `ssh -t richardwhite@100.86.79.4 'ssh-copy-id richardwhite@100.74.2.126'` (enter the mini's password once); and **store the age private key in his password manager** (without it the offsite backups are unrecoverable).

**Done 2026-07-07 (step 4 groundwork: self-hosted Supabase live on the Studio, trial migration verified):**
- **A full self-hosted Supabase stack runs on the Mac Studio** under Colima (no-sudo container runtime at `~/.local/bin`; VM: 2 CPU / 3GB / 30GB, autostarts at login via `com.berwilson.colima`). Official compose trimmed to 8 services (`~/supabase-selfhost/docker/docker-compose.lean.yml`) — realtime/edge-functions/supavisor dropped after verifying zero app usage; Postgres 17.6 exactly matches cloud; fresh secrets + self-signed ANON/SERVICE_ROLE JWTs in `docker/.env`. Stack idles at ~1.1GB of the 3GB VM.
- **Trial migration passed end-to-end:** cloud → local via pg_dump inside the db container (public schema+data; auth+storage data). All counts match (3 users, 97 projects, 20 tasks, 124 chunks, 56/56 storage files synced with a supabase-js script). Explicit API-role grants applied post-restore. Verified live: GoTrue health, PostgREST returning real rows, buckets listing, `match_chunks` vector search returning real chunks. The 3 restore errors were all empty tables (verified in cloud) — zero data loss.
- **Cloud DB password was reset** via the Management API (needed for pg_dump; nobody had it stored; app unaffected — it authenticates with API keys). Stored at `~/supabase-selfhost/.cloud-db-password` on the Studio.
- **Backups live:** nightly 2:30am `pg_dumpall` + storage tarball → `~/Backups/berwilson/`, 14-day retention (`com.berwilson.backup`); first run verified (1MB db + 141MB storage). **Offsite copy pending** — needs SSH on the Mac mini or another target; do before cutover.
- **NOT cut over:** both apps (Vercel + Studio) still use cloud Supabase. Cutover runbook is in `deploy/README.md` (freeze → fresh dump/restore → point Studio app at local via a second `tailscale serve` listener on :8443 → step-3 re-embed → verify → decommission). Awaiting Richard's go after he's driven the Studio instance.

**Done 2026-07-07 (step 1 of the full-local migration: app self-hosted on the Mac Studio):**
- **The platform now runs on the Mac Studio, tailnet-only: `https://richards-mac-studio.tail0e5306.ts.net/`** (via `tailscale serve` → localhost:3000; also `http://100.86.79.4:3000` inside the tailnet). Vercel keeps running in parallel until cutover (step 5). Deployed and verified: HTTP 200 on /login over tailnet HTTPS, middleware auth redirect working, `com.berwilson.platform` launchd service running, both cron agents registered (daily-brief 6:30am local, risk-scores 1:00am local — these hit localhost with the Studio's own CRON_SECRET; Vercel's crons still run too, so the brief may generate twice until cutover).
- **Deploy kit: `deploy/`** — `deploy-to-studio.sh` (idempotent, run from the MacBook: rsync source → generate Studio `.env.local` from the MacBook one with LM Studio flipped to localhost → npm ci + build → install 3 launchd plists → tailscale serve → health check), plist templates, README with prerequisites + caveats (Microsoft OAuth redirect URI must be added in Azure before connecting the mailbox from the Studio origin).
- **Studio box facts:** SSH enabled (MacBook key authorized), **Node v26 installed no-sudo at `~/.node/bin`** (no Homebrew on the box; plists get the path via `__NODE_BIN__`), LM Studio serving on 1234. **A stale public Tailscale Funnel (n8n-era) was found active on the Studio and got removed** when serve was enabled — the box is no longer internet-exposed. Stray `~/package.json`+lockfile (nodemailer/vercel, June 22) trigger a harmless Next workspace-root warning at build; left in place pending Richard's OK to delete.
- **Studio env = local AI active** (`AI_PROVIDER=local`, LM Studio on localhost, `EMBEDDINGS_PROVIDER=gemini` until step 3). Remaining manual settings on the Studio: Energy → prevent sleep, auto-login (LaunchAgents need a logged-in session after reboot), LM Studio launch-at-login.
- **Remaining steps:** (3) re-embed all chunks locally — do this AT cutover, not before (prod Vercel still embeds queries with Gemini; re-embedding early breaks prod search), (4) self-host Supabase on the Studio + backup regime, (5) decommission Vercel + revoke Gemini key.

**Done 2026-07-06 (local AI provider — step 2 of the full-local migration):**
- **Decision (Richard): move the entire platform off frontier models and cloud hosting onto his own hardware for absolute security.** Agreed 5-step plan: (1) self-host the Next.js app on the Mac Studio behind Tailscale (launchd + `tailscale serve`, no public exposure; crons become launchd jobs hitting the routes with CRON_SECRET), (2) swap runtime AI to local Qwen via LM Studio — **DONE, flag-gated**, (3) re-embed the entire chunks table with the local embedding model, (4) migrate Supabase to self-hosted (official Docker stack on the Studio; sanctioned exception to the no-Docker rule; nightly encrypted pg_dump + storage sync to a second machine REQUIRED before cutover), (5) decommission Vercel + revoke the Gemini key. Steps 1/3/4/5 remain.
- **New `src/lib/ai/local.ts`** — OpenAI-compatible client for LM Studio (plain `fetch`, no SDK; §11 single-provider rule intact): `localChat`, `localChatStream` (SSE parsing + tool-call delta accumulation), `localEmbedding` (truncate >768-dim vectors to 768 + L2 renormalize — MRL — so the pgvector schema is untouched), `extractPdfText` (via new dep `unpdf`), and a stateful `<think>`-tag stream filter (Qwen thinking variants) — filter unit-tested incl. tags split across chunks.
- **Branch points, all gated on `AI_PROVIDER=local` (unset = byte-identical Gemini behavior):** `callGemini`/`callGeminiWithFile` (PDF → local text extraction + text call; image → OpenAI vision content, needs a VL model loaded), `generateEmbedding`, `runAgent` (full agentic tool loop rebuilt in OpenAI format — `agentTools` were already plain JSON Schema; Gemini-format history converted; streaming preserved), `transcribePdfText` (local mode = direct extraction, no model pass), `researchQuery` (**blocked in local mode** with a clear error unless `LOCAL_ALLOW_WEB_RESEARCH=true` — web research/enrichment is inherently external; only the search query would leave). Health page requires `LOCAL_AI_BASE_URL` instead of `GEMINI_API_KEY` when local. `ai_queries` logging kept on all paths (refactored into shared `logAiQuery`).
- **Env (documented in `.env.local`, commented out):** `AI_PROVIDER=local`, `LOCAL_AI_BASE_URL=http://100.86.79.4:1234/v1`, `LOCAL_AI_MODEL` (must match LM Studio's model identifier), `LOCAL_EMBEDDING_MODEL`, `EMBEDDINGS_PROVIDER` (overrides; defaults to AI_PROVIDER — **CRITICAL: query embeddings must match stored chunk embeddings; flipping to local without the step-3 re-embed silently breaks retrieval. Staged cutover: set `EMBEDDINGS_PROVIDER=gemini` until the re-embed runs**), `LOCAL_ALLOW_WEB_RESEARCH`.
- **LIVE-TESTED 2026-07-07 — works.** The Studio came online; actual model is **`qwen/qwen3.6-35b-a3b`** (Qwen 3.6 35B A3B, a hybrid-reasoning MoE) with `text-embedding-qwen3-embedding-0.6b` alongside (36GB fits both). `.env.local` is configured live: `AI_PROVIDER=local` + `EMBEDDINGS_PROVIDER=gemini` (until the step-3 re-embed). Verified end-to-end from lib-level scripts against the real DB: (1) `runAgent` full loop — company context injected, `list_projects` tool call executed, grounded streamed answer, 12.7s, ~12k tokens in; (2) real extraction prompt — correct assignees/risks/confidence, valid JSON, **~48s** (the model spends ~3k reasoning tokens; generation itself is ~75 tok/s); (3) embeddings 768-dim unit-norm; (4) `ai_queries` logging captured it all with the local model id. **Latency expectation: flash-equivalent tasks run ~30-60s locally vs ~5-15s on Gemini — that's the price of local.** Tested `/no_think` (Qwen soft switch): no meaningful token/latency reduction on real extraction — deliberately NOT adding a knob (no demonstrated benefit). LM Studio separates reasoning into `reasoning_content`, so the `<think>` filter is defense-in-depth only.
- **`.env.local` now also holds the Supabase URL/anon/service-role keys** (pulled via `supabase projects api-keys` — Vercel marks them Sensitive so `vercel env pull` leaves them empty). Local `npm run dev` is fully functional for the first time; Richard can log in and drive the app in local-AI mode in the browser.
- `tsc` + eslint + full `next build` clean. PDF extraction verified with a real file; think-filter unit tests pass.

**Done 2026-07-06 (directory pass: contact tags, vendor wipe, mass delete):**
- **Vendor data wiped in prod (Richard's call):** 150 of 151 `entities` deleted (bulk auto-created 2026-05-17/18 by enrichment/intake — federal agencies, tribes, orgs — with 2,507 `entity_projects` links, all cascaded away). Kept the one manual entry ("Dino plumbing and HVAC", added 2026-07-04, zero links).
- **Contact tags:** `parties.tags text[]` + GIN index (migration `20260706000001_party_tags.sql`, **APPLIED**; gen-types run). Free-form, self-maintaining vocabulary — no tags table, no admin screen; mirrors `entities.specialties`. New shared `TagInput` (chip input, autocomplete from tags in use via `GET /api/parties/tags`, Enter creates; exact match reuses canonical casing). Wired into: ContactForm (create), contact detail (new "Company & Tags" card, saves per change), contact tiles (clickable tag chips → filter), a tag-filter dropdown with counts on the contacts toolbar, and `parties/[id]` PATCH (`tags` allowlisted + sanitized).
- **Contact ↔ vendor link editable:** new `CompanyLinkEditor` on contact detail + `PUT /api/parties/[id]/company` (link existing entity / find-or-create by name / unlink; keeps `parties.company` text and the `party_entities` primary link in sync). Create-time linking already existed in `contacts/actions.ts`.
- **Contacts search broadened:** now also matches tags, email, phone, and relationship notes (page ships `tags`+`relationship_notes` to the client; still client-side filtering — fine to several thousand contacts, move to server-side tsvector only if payload/latency ever hurts).
- **Mass delete from both tile views:** Select mode on ContactsClient + VendorsClient (toggle → tap tiles, Select all (filtered), Delete (N) via ConfirmDialog). `POST /api/parties/bulk-delete` (archives, same soft-delete semantics as single delete) + `POST /api/entities/bulk-delete` (hard delete, 409s if a child entity outside the batch blocks the parent FK); both use `actorAdminClient()`, both admin-only by default (not in any role allowlist). "Delete inactive contacts" = sort by Recently Active / filter, Select all, Delete.
- `tsc` + full `next build` clean; lint survivors on touched files are the documented pre-existing classes.

**Done 2026-07-05 (code review + cleanup pass):**
- **Security hardening: role resolution now fails closed.** Both `getViewer()` (`src/lib/auth/viewer.ts`) and the middleware defaulted to **admin on any DB error**, not just the missing-column pre-migration case. Now only PostgREST error `42703` (column doesn't exist = migration not applied) keeps the admin default; any other failure (transient DB error) resolves to `member`. Worst case is an admin briefly seeing the member view during a Supabase blip — never an escalation.
- **Real React bugs fixed:** `useSuggestion` was a plain function named like a hook in `QueryInput` + `ResearchPanel` (rules-of-hooks violation; made the React Compiler skip both components) — renamed `applySuggestion`. `DailyBrief` + `ProjectNarrativeBrief` referenced `generateBrief` from an effect above its declaration (blocked compiler memoization) — reordered; both also nested the refresh `<button>` inside the header `<button>` (invalid HTML, hydration errors) — headers restructured as a div with sibling buttons (same look/behavior). `TimelineView` called `Date.now()` inside `useMemo` — now captured once at mount via lazy `useState`.
- **Type-safety:** removed 12 stale `as any` casts (ProjectForm ×9, project detail, vendor detail ×2) — the generated types have covered those columns (capture fields, `entities.category`) since the last gen-types run. ~23 `any` escapes remain (§7 count updated).
- **Dead code swept:** unused `formatValue`/`formatPct`/`formatDate`/`startUploads`/`ScoreDisplay` helpers, ~25 unused imports/vars/params across 22 files, stale Perplexity migration notes in `research.ts` header. Also fixed: expression-as-statement in `MeetingPrepButton`, missing `onSuccess` dep in `CompanyProfileClient`'s cert form effect, unescaped apostrophe.
- **Reviewed clean (no changes needed):** cron auth (fails closed), middleware gating, `permissions.ts` allowlists, `admin.ts` actor stamping, rate limiter, `vercel.json` crons; no dangling references to removed modules. Lint 76 → 21 problems; every survivor is a documented accepted class (§9). `tsc` + full `next build` clean.

**Done 2026-07-03 (production-readiness pass: cron fixes, agent self-fetch refactor, system health):**
- **The daily brief never ran in production — three compounding failures, all fixed.** (1) `/api/cron/daily-brief` was never in `vercel.json`'s crons (only risk-scores was) — now scheduled at 12:30 UTC (6:30am SLC summer). (2) It wasn't on the middleware public allowlist, so even an external trigger bounced to the auth wall — added (it self-guards via CRON_SECRET). (3) `CRON_SECRET` was never set in Vercel, so risk-scores has been 401ing daily too — generated and set in all three envs. **Security fix:** both cron routes' auth was `authHeader !== 'Bearer ${undefined}'` when the secret was unset — a literal `Bearer undefined` header passed on a public route. Both now fail closed (`!process.env.CRON_SECRET || …`).
- **Agent self-fetch antipattern removed.** `draft_email`/`draft_agenda`/`draft_status_report` and `get_attention_items` fetched `NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'` — broken in prod (env var never set; and cookie-less self-fetches would have hit the auth middleware anyway). The attention engine moved to `src/lib/attention.ts` (`computeAttention()`); draft generation moved to `src/lib/ai/draft.ts` (`generateDraft()`). Routes (`api/attention`, `api/ai/draft`) are thin wrappers keeping auth/rate-limit; agent tools call the libs directly. **Rule: agent tools never fetch the app's own HTTP routes — extract shared logic into `src/lib` instead.**
- **New `/settings/health` (admin-only, sidebar System group + mobile More):** live checks on every load — daily-brief + risk-scores cron freshness (fail >36h), AI pipeline (last `ai_queries` call + 24h count), Microsoft Graph token (connected mailbox, flags a missing `Mail.Read.Shared` scope → tells you to reconnect), failed email-research runs (7d), and required-env presence. Server component, direct admin-client queries, card idiom. This is the "background work fails silently" alarm surface.
- **Hygiene verified:** `npm run gen-types` run — generated `database.ts` byte-identical to the committed hand-extended file (user-access reconciliation done). Vercel env audit: retired vars already gone; `SYSTEM_USER_ID` no longer referenced in code. `tsc` + eslint + full `next build` clean.

**Done 2026-07-03 (polish pass: research-run visibility, fit persistence, pursuit profile):**
- **Email research runs are visible immediately.** `api/email-research/run` stages a `running` `email_intake_sessions` row up front (label = search term), so navigating away no longer means minutes of "nothing happened"; every failure path (and a new top-level catch) flips it to `failed` with the error stored in `extraction_result.error`; success updates the same row to `pending` (new `sessionId` input on `analyzeEmailReport` — update-in-place instead of insert). Status values `running`/`failed` are app-level only (plain-text column, no migration). UI: Recent list renders running rows (spinner, non-clickable) and failed rows (error text + dismiss ✕); `SessionsAutoRefresh` re-fetches every 15s while a run is live; the `[id]` review page guards running/failed sessions (auto-refreshing "still running" card / error card); stale `running` rows (>15 min, function cap is 5) display as failed. New `api/email-ingestion/sessions/[id]` PATCH = dismiss (blocked for confirmed); dismissed sessions are hidden from Recent.
- **Fit assessments persist.** `proposal_intake_sessions.fit_assessment jsonb` (migration `20260704000007`, APPLIED; gen-types run) — `api/proposals/intake` now stores what it returns. Email-intake sessions already stored theirs.
- **Backfill verified clean** in prod (0 missing across all four targets); the BackfillCard was already gone from `/intel`. The admin endpoint `api/admin/backfill-embeddings` is kept as a recovery tool.
- **Pursuit profile: derivable gaps filled in prod** (via `db query`): `website`, `hq_address` (South Jordan, UT — from the brief), draft NAICS (236220/332311/238120/237990 — confirm vs SAM.gov), **disqualifiers** (no CUI/CMMC-L2 work pre-GovCloud per §8; no set-aside bids until certs verified in hand; no deals shifting catastrophic risk onto host communities), **past_performance** (honest: no completed references yet — lists the White House Quantum Rail proposal, CQM/EM 385-1-1 posture, active UT pipeline; tells the assessor to treat past performance as unproven). **Deliberately still empty:** project size range (live pipeline spans sub-$1M municipal to $2B+ programs — a made-up floor/ceiling would distort pursue/pass), annual revenue, bonding. Delivery methods/vehicles remain assumed-unconfirmed. All remaining asks are listed inside `pursuit_notes` on `/company`.

**Done 2026-07-03 (executive design pass — dashboard):**
- **Design thesis: calm executive instrument, not consumer dashboard.** `HealthPanel` rebuilt as a 4-stat KPI band (Pipeline Value, Weighted Pipeline, Active Projects, Needs Attention w/ color-coded breakdown) — the synthetic 0–100 health score, gradient ring, animated count-up numbers, per-row progress bars, and stacked bar were all removed (real numbers only; component is now a server component). **One card language everywhere:** `rounded-xl border border-border bg-card elev-1`, panel headers = 11px small-caps muted label + tabular count (`ClosingSoon`, `NeedsAttention`, `RiskOverview`, `NowObjectives` aligned; `ProjectCard` uses standard `.lift`). Dead CSS idioms deleted from `globals.css`: `.glass-panel`, `.card-hover-glow`, `.animate-count-up`, `.chart-gradient-fill`. **Rule for new UI: use the Card idiom + small-caps panel header; no glassmorphism, no animated numbers, color only for status meaning.** Build clean, pushed.

**Done 2026-07-03 (readability pass):**
- **Type scale bumped at the token level** (`globals.css` `@theme`): `text-xs` 12→13px, `text-sm` 14→14.5px — the two workhorse sizes (~1,450 uses combined), so every screen got larger text from a 10-line change, zero per-file edits. `muted-foreground` darkened in light mode (0.505→0.46) / lightened in dark (0.708→0.75) for small-text contrast. Sidebar + mobile nav inactive items brightened (60%→75% opacity), sidebar icons 15→16px, group labels 10px→11px. "Intake Proposal" renamed "Proposal Intake" everywhere (sidebar, mobile More, ⌘K palette, header title, page + metadata). `tsc` + `next build` clean; pushed.

**Done 2026-07-03 (activity-log user attribution + email-intake copy fix):**
- **The activity log now shows WHO did it.** App writes go through the service-role client, so `auth.uid()` was null inside `log_activity()` and every entry logged as "system". Fix: `createAdminClient(actor?)` can stamp `x-actor-id`/`x-actor-email` headers onto the PostgREST request; new `actorAdminClient()` (`src/lib/auth/viewer.ts`, built on the request-cached `getViewer()`) resolves the signed-in user and returns a stamped client; migration `20260704000006_activity_actor_attribution.sql` (**APPLIED to prod**) teaches the trigger to fall back to those headers when `auth.uid()` is null. Swapped into every user-initiated mutation route on tracked tables (tasks create/patch/delete, projects delete + server actions, updates save, documents insert/update/delete, certification docs, review approve/reject, proposals intake/confirm/upload-chunk, email-ingestion confirm). Routes already on the session-scoped server client (compliance/dd-items/financing/milestones/stage/updates PUT) were always attributed — untouched. Crons/AI/background writes still log as "system", which is accurate. **Rule for new code: user-initiated mutations on tracked tables use `actorAdminClient()`, not `createAdminClient()`.** Verified end-to-end (trigger test in a rolled-back transaction + a PostgREST header-forwarding echo test). No schema change — gen-types not needed.
- **Email Research copy fixed:** the loading state said "Keep this tab open" — wrong. The run is a synchronous server function (`maxDuration` 300s) that completes even if the browser navigates away; the pending session is staged at the end and shows under Recent sessions for later review. Copy now says leaving is safe.

**Done 2026-07-03 (user management + role-based access — foundation):**
- **Four role presets** (`src/lib/auth/permissions.ts`): `admin` (everything), `executive` (Tasks + Objectives, full edit), `project_manager` (granted projects/opportunities + tasks within them; grants on a parent project cascade to children), `member` (own task list only). Anything not explicitly allowed for a role is admin-only by default — new routes are born private.
- **Schema** (migration `20260704000005_user_access.sql`): `team_members` gains `auth_user_id` (unique, links to Supabase Auth), `email`, `role` (existing Richard/Eric rows set to admin); new `access_grants` table (member × project|opportunity). `database.ts` hand-extended.
- **Enforcement, three layers:** (1) middleware resolves the signed-in user's role and gates page/API path prefixes (redirect to `/tasks` / JSON 403); (2) `src/lib/auth/viewer.ts` — `getViewer()` (request-cached), `canAccessProject` (walks parent chain), `canAccessOpportunity`, `filterTasksForViewer`, `canCreateTask` — wired into: tasks API (list filter, create/patch/delete guards, notes), team-members POST, projects list/detail-layout/new/actions/PATCH/stage/DELETE/parents, documents upload/insert/delete/signed-url, milestones POST/PATCH, opportunities list/detail/edit/actions/PATCH/notes/docs; (3) RLS unchanged — still defense-in-depth (§8); move to grant-keyed RLS when external partners get accounts.
- **Safety rules in `getViewer` (mirrored in middleware):** pre-migration (columns missing) → everyone admin (today's behavior, code ships first); linked → their role; bootstrap (no linked, active **admin** exists yet) → unlinked users are admin (fixed same day — the first version ended bootstrap on ANY link, so inviting a PM first demoted the unlinked executive logins to member mid-session); unlinked once an admin is linked → member. Last-active-admin demotion blocked server-side.
- **People-data rule (Richard's call):** executives = full edit on tasks/objectives; PMs get a **limited players list** on granted projects (name/role/company/email — no `/contacts` profile links, no add/edit/remove, no DD notes). Directory/contacts stay admin-only.
- **AI + cross-portfolio surfaces are admin-only** for now: Ask Ber AI dock, ⌘K palette/search, quick upload hidden for non-admins in the shell; `/api/ai/*`, `/intel`, dashboard, review, activity, email intake, proposals all outside non-admin allowlists. Per-grant RAG scoping is deliberate future work.
- **`/settings/users` (admin-only; sidebar System group + mobile More):** role legend, member cards (role dropdown, activate/deactivate, grant chips + editor for PMs), invite modal (new person or link an existing unlinked member; email invite via `admin.auth.admin.inviteUserByEmail` → existing `/auth/confirm` → set-password flow; already-registered emails just link instead of failing). API: `api/admin/users` (GET/POST, 409 pre-migration), `api/admin/users/[id]` (PATCH role/active/grants).
- **Known v1 limits:** PM mutations on updates/diligence/financing/players/parties are blocked by the API allowlist (read-only on their project pages); executives see project names as task tags (by design — they run the whole board). `tsc` + eslint + full `next build` clean. Local runtime smoke impossible (Supabase env vars are marked Sensitive in Vercel and pull empty; pre-existing situation).

> **DB push status (2026-07-03, user access): DONE.** Migration `20260704000005_user_access.sql` applied; `info@berwilson.com` → Richard and `tuaone@berwilson.com` → Eric linked as admins directly in prod (via `db query --linked`); the first PM was invited via `/settings/users` and correctly sees only their granted projects. Remaining: `npm run gen-types` to reconcile (hand-extended types match). Note: Dennis/Nancy rows show role=admin from the migration's blanket update but are unlinked (no login) — the invite flow overwrites role at invite time, so this is cosmetic.

**Done 2026-07-03 (chief-of-staff pass: objectives wired in, one Directory, task truth completed):**
- **Tasks can be tagged to an objective.** New nullable `tasks.objective_id` (FK → `objectives`, on delete set null) via migration `20260704000003_task_objective_tag.sql`, mirroring the opportunity-tag pattern exactly: dual-schema tolerant (tag written only when chosen; objective controls render only when objectives exist), `database.ts` hand-extended. Board add-form picker + filter + Target-icon chip; TaskDetailSheet picker + steering-board link card; API create/patch/filter (`?objective=`). `/tasks` fetches active objectives sorted Now → Soon → Possibly.
- **Objectives lead the morning read.** Dashboard opens with a `NowObjectives` strip (rank, owner initials, target date, open-task count from the new tag; links to `/objectives`). The daily-brief cron injects Now/Soon objectives into its prompt and gained a **Steering Check** section (urgent items lined up against stated priorities; calls out Now objectives with no movement). Both fail quietly pre-migration.
- **One Directory (nav 14 → 13).** `/contacts` is now "Directory" with **Contacts | Vendors & Contractors** tabs (`?tab=vendors`); the old `/vendors` list is a redirect stub (detail/new routes stay). Sidebar (item: "Contacts & Vendors", highlights on `/vendors/*` too), mobile More, ⌘K palette (both tabs reachable), header titles updated.
- **Extraction action items → real tasks (column dropped).** `api/updates/save` converts human-confirmed action items into `tasks` rows (assignee resolved by name against `team_members` via new `src/lib/tasks/from-action-items.ts`); review-queue approval converts legacy pending items then clears them (no-ops post-drop). Action-item display/editing removed from UpdatesTab/UpdateEditModal/ReviewEditModal + the PATCH toggle route; dead `AssigneeInput.tsx` deleted. Migration `20260704000004_drop_action_items.sql` drops `updates.action_items`; `database.ts` hand-trimmed.
- `tsc` + eslint clean on touched files (remaining errors are the documented pre-existing ones); full `next build` clean. Three commits pushed to main (auto-deployed).

> **DB push status (2026-07-03, chief-of-staff pass):** two new migrations to apply — `20260704000003_task_objective_tag.sql` (needs `20260704000002_objectives.sql` first) and `20260704000004_drop_action_items.sql` (independent, safe any time). After pushing all pending migrations: `npm run gen-types`. Pre-migration degradations are all graceful: objective tagging errors only if an objective is actually picked, the Dashboard strip/brief section stay hidden, and everything else works.

**Done 2026-07-03 (objectives steering board):**
- **New top-level area `/objectives`** — the chief-of-staff priority board: company objectives sorted into **Now / Soon / Possibly** columns, drag-and-drop to re-prioritize (order = priority; cards are rank-numbered), quick-add per column, click-to-edit (title, note, owner from `team_members`, target date), per-card menu (move up/down, move to bucket, archive, delete via ConfirmDialog). Archive is a collapsible section below the board — done/parked objectives keep their record. Native HTML5 DnD, no new deps; the card menu covers mobile where drag is impractical.
- **PDF export via a print view:** `/objectives/print` (chromeless — excluded from the app shell in `layout.tsx` the same way login is) renders a letterhead document (logo, "Strategic Objectives", prepared date, numbered sections); a screen-only toolbar picks Everything or a single bucket and triggers the browser print dialog (Save as PDF). No PDF library — `@react-pdf/renderer` stays uninstalled.
- **Schema:** one tiny table via migration `20260704000002_objectives.sql` — `objectives` (title, note, bucket text now|soon|possibly, sort_order, owner_id FK→team_members, target_date, status active|archived). Plain-text bucket/status + app constants (`src/lib/utils/objectives.ts`), `updated_at` trigger only (not `log_activity()`), RLS like opportunities. `database.ts` hand-extended; `Objective` alias in `lib/supabase/types.ts`.
- **API:** `api/objectives` (GET/POST — create appends to bucket bottom), `api/objectives/[id]` (PATCH whitelist / DELETE), `api/objectives/reorder` (POST — persists a drag result as full bucket re-numbering; board is tiny, per-row updates).
- **Nav 13 → 14:** sidebar primary group (after Dashboard, Target icon), mobile More, ⌘K palette, header titles.
- `tsc` + eslint clean on touched files; full `next build` clean.

> **DB push status (2026-07-03, objectives):** `20260704000002_objectives.sql` must be applied (Richard runs migrations), then `npm run gen-types`. Pre-migration, `/objectives` shows its error screen ("make sure the migration has been applied") — nothing else is affected.

**Done 2026-07-03 (simplification pass 2 — cut the off-mission modules):**
- **Equity & Valuation removed** (~6.4K lines): `src/app/equity`, `components/equity`, `lib/equity`, `api/equity`, equity hooks/store/types, nav + middleware + layout references. `formatCurrencyCompact` relocated to `src/lib/utils/format.ts` (TaskDetailSheet imports it from there). Four now-orphaned deps uninstalled: `@tanstack/react-query`, `zustand`, `@react-pdf/renderer`, `recharts`.
- **Portfolio site-hierarchy removed** (~5K lines): `src/app/portfolio`, `components/portfolio`, `api/portfolio`; the two site-scoped agent tools (`get_stakeholders`, `get_funding_sources`) + their prompt guidance; portfolio constants/enums/type aliases; `site_id` handling in `api/documents/upload`. **Kept:** `portfolio_briefs` (the daily whole-company brief), `get_portfolio_summary` (cross-project), risk scoring. Decision context: a CFO hire is coming — if finance tooling is needed, build a fresh section, don't resurrect this.
- **Speculative cuts:** background checks (widget + API + contact-page section), vendor scorecards & reviews (FederalScorecardSection, ReviewForm, API routes, review stats in the vendors list/detail), Procore stub, dead scraper-era Graph webhook/processed-email helpers in `microsoft-graph.ts`, outlook_web_link UI in UpdatesTab.
- **Nav 15 → 13** (Finance group gone). Sidebar/mobile/⌘K/header titles updated.
- **Opportunities gained `on_hold`** ("On Hold", amber) — parked deals no longer masquerade as active or get force-closed. Outside the pipeline bar (detail page shows an On Hold banner). Plain-text status, app constants only (`src/lib/utils/opportunities.ts`), no migration.
- **UI consistency:** new shared `ConfirmDialog` (`src/components/ui/confirm-dialog.tsx`); every `window.confirm()`/`window.alert()` replaced with it + sonner toasts. Dark mode now follows `prefers-color-scheme` when no explicit theme is stored (toggle still overrides).
- Migration **`20260704000001_simplification_drops.sql`** drops it all: equity ×2 tables, portfolio ×12 tables + 9 enums + site/component columns on documents/compliance_items/activity_log/chunks (site-scoped chunks deleted; `documents_scope_check` re-created without site refs), `federal_scorecards`, `entity_reviews`, parties `background_check_*` columns, `processed_emails`, `graph_subscriptions`, `trade_secrets`, `ts_exposure_items`, `document_distributions`, `updates.outlook_web_link`. All `IF EXISTS` — code shipped first, so it can land any time.
- `database.ts` hand-trimmed to match; `tsc` + full `next build` clean.

> **DB push status (2026-07-03, simplification pass 2):** `20260704000001_simplification_drops.sql` must be applied (Richard runs migrations), then `npm run gen-types`. Nothing breaks pre-migration — the dropped tables/columns simply sit unused. **Data in the dropped tables (equity scenarios, portfolio sites/stakeholders/funding, scorecards, reviews) is permanently deleted — confirmed OK 2026-07-03.**

**Done 2026-07-03 (simplification + ambient AI — "simplification is sophistication" pass):**
- **Task truth unified.** All "what needs me" surfaces now read the `tasks` table instead of legacy `updates.action_items` JSON: `/api/attention`, `/calendar`, project + portfolio briefs, drafts, meeting prep, the daily-brief cron (which also gained a "due in 7 days" section), and the agent's `get_open_items`. Shared helper: `src/lib/tasks/queries.ts` (`fetchOpenTasks` + prompt formatters, dual-schema tolerant, no embeds).
- **IA consolidated (19 → 15 nav destinations).** `/attention` → Dashboard (Needs Attention panel gained an Overdue Tasks section; sidebar red badge moved to Dashboard and now includes overdue tasks). `/capacity` → `/tasks` (per-person workload chips: open + overdue counts, tap to filter the board). `/email-research` + `/email-ingestion` → one **Email Intake** page at `/email-ingestion` (sweep form first, manual paste behind a disclosure, recent sessions below). Timeline left primary nav, linked from the Projects toolbar. All three old routes are `redirect()` stubs. Sidebar/mobile nav/⌘K palette/header titles all updated.
- **Agent streams.** `/api/ai/agent` gains SSE mode (`stream: true`): live tool-activity events ("Checking search knowledge base…") + token-by-token answer streaming; legacy JSON mode kept. `runAgent` now uses `generateContentStream` with optional `onToolCall`/`onTextDelta` callbacks; `maxDuration=300`.
- **Ambient Ask Ber AI.** New `AskBerAIDock` (global slide-over, mounted in the shell): header button, **⌘J/Ctrl+J**, or `window` event `open-ber-ai`; stays mounted when closed so the conversation survives reopen. Context-aware — auto-scopes to the project on `/projects/[id]*`. The ⌘K palette has a pinned "Ask Ber AI: <query>" first row that hands the typed query to the dock. The two inline `AskBerAIPanel` embeds (dashboard, project layout) were deleted — one surface now.
- `tsc` + eslint clean on touched files; full `next build` clean. Four commits pushed to main (auto-deployed). No DB changes.

**Done 2026-07-02 (universal RAG + in-platform Email Research — n8n retired):**
- **Feature A — universal cross-CRM query.** The RAG architecture was sound but coverage had holes; closed them:
  - **Full PDF text is now indexed.** All three document-upload routes (`api/documents/upload`, `api/documents`, `api/opportunities/documents`) run a second Gemini transcription pass (`src/lib/ai/document-text.ts`, PDFs ≤15MB, `maxTokens 60000`), store it in new `documents.extracted_text` / `opportunity_documents.extracted_text`, and embed the FULL text instead of the 2-3 sentence summary (summary remains the fallback for oversize/failed extraction). `maxDuration=300` on those routes.
  - **Opportunities are searchable.** New chunk columns `opportunity_id` / `opportunity_document_id` / `source_type`; new embedders in `embeddings.ts` (`embedOpportunityDocument` / `embedOpportunitySnapshot` (delete-and-replace on create/edit/PATCH) / `embedOpportunityNote` / `embedOpportunityReport`), all built on a shared `insertChunkTolerant` helper that drops unknown columns (PGRST204) and detects the old check constraint (23514) → warn+skip pre-migration. Wired into opportunity create/edit/PATCH, notes POST, doc upload, and email-ingestion confirm.
  - **4 new agent tools** (`agent-tools.ts`): `list_opportunities`, `query_opportunity` (fuzzy name resolve + notes + doc metadata), `search_tasks` (assignee/project/opportunity/status filters, latest note), `get_document_content` (reads `extracted_text` so the agent can quote sources; tolerant retry). Agent prompt now explains the opportunities-vs-projects split. `search_knowledge_base` + synthesize citations label opportunity chunks (`Opportunity: <name>`).
  - **One-time backfill:** `api/admin/backfill-embeddings` (batched; targets `project_documents` / `opportunity_documents` / `opportunities` / `opportunity_notes`; 409 with a clear message pre-migration) + `BackfillCard` on `/intel` that loops until done (stall guard). Remove the card after the backfill runs clean.
  - Migration **`20260703000001_universal_rag.sql`**: chunk columns + relaxed `chunks_source_check` + `extracted_text` columns + `match_chunks` DROP/recreate with **identical args** and extended return shape (so `match-chunks.ts` needed no change; the old RPC pre-migration just returns rows without the new fields).
- **Feature B — Email Research moved fully in-platform (n8n / Mac Studio / local Qwen retired).**
  - New `src/lib/integrations/graph-search.ts`: `searchConversations` (Graph `$search`, KQL-escaped, client-side date filter — `$search` can't combine with `$filter`/`$orderby`; groups hits by `conversationId`, newest-first, cap 15) and `fetchConversationMessages` (`$filter=conversationId eq`, **no $orderby** — Graph rejects the combo; JS sort, most recent 30 kept). **Multi-mailbox (added same day):** every run sweeps `RESEARCH_MAILBOXES` = tuaone@ + info@ + moose@berwilson.com using tuaone's single OAuth grant via `/users/{mailbox}/…` — requires the `Mail.Read.Shared` scope (added to SCOPES; **reconnect via `api/email/oauth` once to pick it up**) plus tuaone having delegated read access to the shared mailboxes in M365. Per-mailbox failures degrade to a note in the report; threads/messages deduped across mailboxes by `conversationId`/`internetMessageId`.
  - New `api/email-research/run` (`maxDuration=300`, auth-gated): search → per-thread transcript (`extractPlainText`, 6k chars/msg) → attachments (deduped name+size across reply chains, max 3/thread; inline/>10MB/non-PDF-image skipped with a note line in the report) → Gemini flash extraction per attachment → one markdown report (~190k char cap, oldest threads trimmed with a note) → `analyzeEmailReport` → `{session_id}` → client redirects straight to the `/email-ingestion/[id]` review screen. No auto-confirm — human review stays mandatory.
  - `EmailResearchForm` reworked: synchronous run with a "takes 1–4 minutes" loading state + time-range select (90d/1y/all); redirects to review on success. Manual paste on `/email-ingestion` still works as a fallback.
  - **Removed:** `api/email-research/trigger`, `api/email-ingestion/inbound` (+ its `middleware.ts` public-allowlist line), the `n8n/` directory, and the three n8n env vars (see §7 — Richard deletes them from Vercel). `SYSTEM_USER_ID` kept as the auth fallback.
  - **Confirm-time RAG tie-in:** on email-ingestion confirm, project-kind stores the report as an approved `updates` row (visible on the project's Updates tab) + `embedUpdate`; opportunity-kind runs `embedOpportunityReport` + snapshot. The handoff document itself becomes queryable from `/intel`.
- `tsc` + eslint clean on all touched files; `next build` clean. Both features pushed to main (auto-deploys).

> **DB push status (2026-07-02, universal RAG):** `20260703000001_universal_rag.sql` must be applied (Richard runs migrations), then `npm run gen-types`. **Pre-migration degradations (all silent, nothing breaks):** PDF full text is embedded but not stored; opportunity snapshot/note/doc/report embedding warn+skips; `get_document_content` returns summary-only; backfill returns 409. **Post-push checklist for Richard:** `supabase db push` → `npm run gen-types` → open `/intel` and run all four backfill targets → spot-check by asking the agent about a PDF's contents and an opportunity. Also: the **first `/email-research` run may need a Microsoft reconnect** (`api/email/oauth`) if the stored token predates the Mail.Read scope.

**Done 2026-07-02 (Email Research trigger + automatic ingestion) — SUPERSEDED same day: the n8n trigger/inbound plumbing described below was replaced by the in-platform run above; kept for history:**
- **Closed the loop both ways** so reports arrive automatically instead of being copy-pasted. Two distinct secrets: `N8N_WEBHOOK_SECRET` (outbound trigger) and `INGESTION_INBOUND_SECRET` (inbound delivery) — never reused, never client-side.
- **Trigger:** new authenticated page **`/email-research`** (`EmailResearchForm`) — search term + optional export label + "Run Email Research". Fire-and-forget: it POSTs to `api/email-research/trigger`, which (auth-gated) makes a server-to-server POST to `process.env.N8N_WEBHOOK_URL` with header `X-Webhook-Secret: N8N_WEBHOOK_SECRET` and body `{ searchTerm, exportLabel }`, returns as soon as the webhook is dispatched (10s abort cap), and never leaks the URL/secret. Confirmation tells the user the report will show under Email Ingestion > Recent.
- **Inbound:** new **`api/email-ingestion/inbound`** (called by n8n, not a browser) — added to `middleware.ts`'s public allowlist (exact path `=== '/api/email-ingestion/inbound'`); its only auth is header `X-Ingestion-Secret === INGESTION_INBOUND_SECRET` (401 otherwise). Accepts `{ raw_text, label }` and runs the **exact same shared processing path** as the manual paste flow. Lands as a `pending` session under Recent — **no auto-confirm**; the human review/confirm step stays mandatory.
- **Refactor (no behavior change):** the analyze core was extracted into `src/lib/email-ingestion/analyze.ts` (`analyzeEmailReport({ rawText, label, userId })`, `EmailIntakeError` with HTTP status, `SYSTEM_USER_ID`). Both `api/email-ingestion/analyze` (manual paste/upload — user resolution + storage read stay in the route) and `api/email-ingestion/inbound` call it, so there's one source of truth. The manual paste/upload flow is unchanged (same request/response contract).
- **Env:** `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `INGESTION_INBOUND_SECRET` documented in §7 (values supplied separately, server-only). **Nav:** `/email-research` added to sidebar Intelligence group, mobile More, command palette. `tsc` + eslint clean.

**Done 2026-07-02 (Email Ingestion module):**
- **New top-level area `/email-ingestion`** (in the sidebar **Intelligence** group, mobile More, command palette). Closes the "email an opportunity → Ber AI assesses → you decide → records created" loop for existing Outlook threads. Richard's external **n8n workflow on his Mac Studio** (local Qwen) gathers threads+attachments and produces a markdown research report; the platform digests it. **This does NOT re-add the forbidden email scraper (§11)** — all Graph scraping stays external in n8n; the platform only accepts a document a human pastes, and creates records only after human review.
- **Delivery = paste/upload** (chosen over auto-POST). The report is pasted (or a `.md`/`.txt` dropped, read client-side as text). Auto-POST is a documented future add (`n8n/README.md`): a token-gated `/api/email-ingestion/inbound` on `middleware.ts`'s allowlist.
- **Flow:** `POST /api/email-ingestion/analyze` (`maxDuration=300`) runs one Gemini pass with `EMAIL_INTAKE_SYSTEM_PROMPT` (`src/lib/ai/prompts/email-intake.ts`) → unified `EmailIntakeExtraction` (suggested opportunity **and** project fields + people + tasks). It **reuses** `findMatchingProjects`/`matchExtractedParties` (`proposal-matching.ts`) and `assessFit` (`fit-assessment.ts`) via a `toProposalExtraction` adapter, then stages an `email_intake_sessions` row (status `pending`). Review screen (`EmailIngestReview`) shows the fit card, a **Project | Opportunity toggle** (user picks per package), editable record fields, matched-vs-new people, and an editable task list. `POST /api/email-ingestion/confirm` creates the opportunity **or** project, matches/creates `parties` (+ `project_players` when project-kind), and `tasks` (tagged with `project_id` or `opportunity_id`, assignee resolved by name against `team_members`).
- **Schema gap noted:** opportunities have **no player link table** — when opportunity-kind, people are recorded in an `opportunity_notes` entry (+ `counterparty`/`lead` free-text) rather than a first-class link. Add `opportunity_players` later if needed.
- **Shared refactor:** the fit-assessment card was extracted from `ProposalIntakeWizard` into `src/components/proposals/FitAssessmentCard.tsx` (single source; both surfaces import it).
- New migration `20260702000001_email_intake.sql` (`email_intake_sessions`, `updated_at` trigger only — **not** `log_activity()`). `database.ts` hand-extended. `tsc` + eslint clean (the pre-existing `ProposalIntakeWizard` setState-in-effect lint error at ~L139 is untouched).

> **DB push status (2026-07-02):** `20260702000001_email_intake.sql` must be applied to the live Supabase DB (Richard runs migrations). `/email-ingestion` renders and the form works, but analyze/confirm 500 until the table exists. Run `npm run gen-types` after the push to reconcile the hand-extended types. **n8n side:** apply the two in-place edits in `n8n/README.md` (enrich the Qwen prompt; add the paste-into-platform step) — do NOT re-import the workflow JSON (it would wipe the Outlook OAuth credential + model id).

**Done 2026-06-27 (task → opportunity tagging):**
- Tasks can now be tagged to an **opportunity** as well as (or instead of) a project. New nullable `tasks.opportunity_id` (FK → `opportunities`, `on delete set null`) via migration `20260627000002_task_opportunity_tag.sql`. `database.ts` hand-extended (Row/Insert/Update + FK relationship).
- **UI:** `TeamTaskBoard` add-form gets a separate **Opportunity** dropdown next to Project, plus an opportunity filter and an opportunity chip on each task card. `TaskDetailSheet` gets an Opportunity picker + a link card to the opportunity. The opportunity controls only render when opportunities are passed in, so project-scoped task tabs (`TasksTab`, which passes none) are unchanged. `/tasks` page fetches non-closed opportunities and passes them down.
- **Dual-schema tolerant:** opportunity names are resolved from the passed-in list (no PostgREST embed), and the API only writes `opportunity_id` when one is actually chosen — so creating/listing tasks still works before the migration is applied. `tsc` clean.

> **DB push status (2026-06-27):** `20260627000002_task_opportunity_tag.sql` must be applied to the live Supabase DB before opportunity tags persist (tagging an opportunity errors until then; everything else degrades gracefully). It depends on `20260627000001_opportunities.sql` being applied first. Run `npm run gen-types` after the push.

**Done 2026-06-27 (opportunities module):**
- **New top-level CRM concept: `/opportunities`** — strategic pursuits that aren't construction projects (acquisitions, partnerships, JVs, equity investments, mergers, divestitures, teaming agreements, market entry). Modeled like `projects` but lighter and self-contained. Migration `20260627000001_opportunities.sql` adds `opportunities` (name + opp_type + status pipeline + priority + objective + thesis + target/counterparty + deal terms + value/stake/probability + dates + next_step), `opportunity_documents` (white papers / teasers / CIMs / financials — kept **separate** from `documents` so it doesn't touch the RAG/chunks pipeline; files live in the same Supabase `documents` storage bucket under `opportunities/{id}/`), and `opportunity_notes` (progress feed). Type/status/sector are plain `text` + app constants (`src/lib/utils/opportunities.ts`), no Postgres enums. Only the `updated_at` trigger is attached — **not** `log_activity()`, which dereferences `new.project_id` (this table has none).
- **UI:** `/opportunities` list (type+status filters, card grid `OpportunitiesClient`), `/opportunities/new` + `/[id]/edit` (`OpportunityForm`, server actions in `app/opportunities/actions.ts`), `/opportunities/[id]` detail (pipeline progress bar, key-facts grid, objective/thesis, inline `OpportunityStatusControl`, `OpportunityDeleteButton`, white-paper upload via `OpportunityDocuments`, notes feed via `OpportunityNotes`). Optional Gemini AI summary on uploaded white papers (best-effort).
- **API:** `api/opportunities/[id]` (PATCH whitelisted fields / DELETE + storage cleanup), `api/opportunities/[id]/notes` (POST), `api/opportunities/documents` (POST multipart upload), `api/opportunities/documents/[id]` (DELETE).
- **Nav + search:** added to `AppSidebar` (after Projects), `MobileNav` (More), and the command palette + `/api/search` (new `opportunity` result type).
- **Types:** `database.ts` hand-extended with the 3 tables; aliases `Opportunity`/`OpportunityDocument`/`OpportunityNote` in `lib/supabase/types.ts`. `tsc --noEmit` + eslint clean.

> **DB push status (2026-06-27):** `20260627000001_opportunities.sql` must be applied to the live Supabase DB (Richard runs migrations — Claude can't `supabase db push`). `database.ts` was hand-extended; run `npm run gen-types` after the push to reconcile. `/opportunities` pages are dynamic (await searchParams/params), so `next build` won't try to prerender them, but the routes will 500 at runtime until the tables exist.

**Done 2026-06-25 (task system rebuild + email scraper removal):**
- **Tasks are now a real schema**, not `action_items` JSON on `updates`. New migration `20260625000001_team_tasks.sql` adds `tasks` (title + what/why/how + assignee_id + project_id + due_date + status open|done + completed_at), `task_notes` (the updates/notes feed), and `team_members` (lightweight assignee list, seeded Richard/Eric — deliberately separate from `parties`). Completed tasks set `status='done'` (archived, not deleted).
- **`/tasks` is the new landing screen** (`app/page.tsx` and the login redirect now point to `/tasks`; Tasks moved to top of sidebar + mobile primary nav). `TeamTaskBoard.tsx` is the board (avatar chips, project tags, due pills, quick-add teammate, status/assignee/project filters, Open vs Archive); `TaskDetailSheet.tsx` is a right slide-over with editable what/why/how, a project context card (name/sector/value/players, links to the project), and the notes feed. Project tab reuses the board scoped via `scopeProjectId` (`components/projects/TasksTab.tsx`).
- **New primitives:** `components/ui/calendar.tsx` + `date-picker.tsx` (custom month grid in an outside-click dropdown — no new deps).
- **API:** `api/tasks` (GET/POST), `api/tasks/[id]` (GET detail+players+notes / PATCH / DELETE), `api/tasks/[id]/notes` (POST), `api/team-members` (GET/POST).
- **Email scraper ripped out:** deleted `lib/email/`, `api/email/{webhook,subscribe,backfill}`, `api/cron/renew-subscriptions`, `email-log/`, `components/email/`. Removed the cron from `vercel.json`, the webhook/cron public exceptions from `middleware.ts`, and Email Log from all navs. **Kept** `api/email/oauth(+callback)`, `email_tokens`, and `lib/integrations/microsoft-graph.ts` because `/calendar` + party enrichment use them. Shared extraction (`lib/ai/prompts/extraction.ts`, `api/ai/extract`) kept — still used by proposal intake + manual paste.
- **Core rewire:** Dashboard per-project action counts + deadlines and the contact "Tasks" tab now read the `tasks` table (contact tab matches a `team_member` by name). Attention/Capacity/Calendar/AI-briefs still read legacy `updates.action_items` — left for a later pass.
- **Gemini API key rotated** across Vercel production/preview/development + `.env.local` (2026-06-25). Note: the supplied key starts `AQ.` not the usual `AIza` — verify if AI calls 401.

> **DB push status (2026-06-25):** the `20260625000001_team_tasks.sql` migration must be applied to the live Supabase DB (`supabase db push`). Generated types in `database.ts` were hand-extended for `tasks`/`task_notes`/`team_members`; run `npm run gen-types` after the push to reconcile. A full `next build` will fail to prerender `/tasks` until the tables exist.

**Done 2026-06-22:** Company profile fleshed out with a structured **pursuit profile** (`company_profile` migration `20260622000002`), editable on `/company`, and wired into the AI — the executive agent injects it via `getCompanyContext()`, and proposal intake runs `assessFit()` to give a pursue/consider/pass recommendation in the wizard.

**Done 2026-06-22 (UI lift):**
- **Design system refinement** in `globals.css`: light neutrals carry a faint cool tint (hue 260) to harmonize with the navy sidebar; added a layered elevation scale (`--elev-1/2/3` + `.elev-*`), `.lift` (hover elevation), `.stagger-children`, `.tnum` (tabular figures), and a `prefers-reduced-motion` block. `Card` now defaults to `elev-1` and accepts an `interactive` prop for hover lift+glow on clickable cards.
- **Dark mode** is now wired (pre-paint no-flash script in `layout.tsx` + `ThemeToggle` in the header) **and the color audit is done** (2026-06-23). The portfolio module was already `dark:`-aware; an idempotent transform (`scripts/dark-tints.mjs`) added `dark:` variants to ~1,100 light tint utilities (`bg/text/border/divide/ring-{color}-{50|100|200…}`) across 91 files, preserving `hover:`/`focus:` prefixes. Bare `bg-white` survivors fixed by hand (slider thumb → `bg-background`; login/set-password inputs → `dark:bg-slate-900`; milestone dot left white — it sits on an emerald pill). Dark mode now renders cleanly everywhere via the toggle. It is still **opt-in by default** — the no-flash script only applies `.dark` when `localStorage.theme === 'dark'`; it does NOT follow the OS yet. Flipping it to follow `prefers-color-scheme` is now safe (one-line change in `layout.tsx`) but left as a deliberate choice.
- **Sidebar consistency:** Portfolio/Equity folded into `NAV_GROUPS` (was a hand-coded block with a different active style).
- **Command palette (⌘K / Ctrl+K):** `CommandPalette.tsx` + `AppHeader` host it; new `GET /api/search?q=` does cross-entity ilike search over projects/parties/entities. Replaced the old mobile-only page-search. Desktop search box + mobile search button both open it.

**Highest-leverage next work:**
1. **Refine the pursuit profile** on `/company` — a first draft was written 2026-07-03 (see below); Richard still needs to confirm delivery methods/contract vehicles, add the project size range (min/sweet spot/max), disqualifiers, and past performance. Those four gaps are what's left between "usable" and "sharp" fit assessments.
2. Optionally persist `fit_assessment` on `proposal_intake_sessions` (currently returned in the intake response but not stored).
3. Tend the known debt in §9 as it gets in the way.

**Done 2026-07-03 (migrations applied + pursuit profile seeded):**
- **All migrations through `20260704000004` are applied to prod** and `npm run gen-types` verified `database.ts` matches (byte-identical to the hand-maintained file). Note: `supabase db push` / `supabase db query --linked` DO work from Claude Code when Richard explicitly asks — the old "Richard runs migrations" notes below are historical.
- **Pursuit profile first draft written to `company_profile`** (via `db query --linked`, from Richard's direction: full-spectrum GC, prefab steel manufacturing, military-standard compliance, Native American-owned by a 501(c)(3)): capabilities, all 5 target sectors, geographies (UT flagship + Mountain West + nationwide federal), delivery methods (D-B/D-B-B/CMAR — **assumed, confirm**), contract vehicles (FFP/GMP/Lump Sum — **assumed, confirm**), differentiators, pursuit notes. `about` (the platform brief) untouched. Two certification rows seeded from the brief's credentials line: USACE CQM + DoD EM 385-1-1 (numbers/dates blank). `hasPursuitProfile` is now true — fit assessments no longer self-flag `profile_incomplete`. Left deliberately empty (don't invent): project size range, disqualifiers, past performance, annual revenue, diversity-cert booleans (Native-owned ≠ certified — verify Buy Indian Act / IIP / tribal 8(a) eligibility before claiming set-asides).
- **UX fix:** the Pursuit Profile section on `/company` now has its own Edit button (the only entry point was the "Edit Profile" button at the top of Company Identity — Richard couldn't find it).

> UPDATE THIS SECTION (and §9 if you resolve debt) at the end of every Claude Code session.
