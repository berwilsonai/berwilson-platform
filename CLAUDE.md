# BER WILSON — Executive Intelligence Platform
# Master Architecture & Build Reference (CLAUDE.md)
# Version: 2.0 | 2026-06-22

---

## WHAT THIS FILE IS

Canonical reference for every Claude Code session working on the Ber Wilson platform. Lives in the project root as `CLAUDE.md`; Claude Code reads it automatically.

**This file is the reference. Three things live outside it, none of them auto-loaded — read or grep them when you need them:**

| File | Holds | Split out |
|---|---|---|
| [`docs/BUILD-LOG.md`](docs/BUILD-LOG.md) | the session-by-session history, with the reasoning and measurements behind every decision | 2026-09-23, at 606k characters |
| [`docs/OPEN-ITEMS.md`](docs/OPEN-ITEMS.md) | the full open-items table; §13 keeps only the rows wanting a decision from Richard | 2026-10-01, at 143k |

§12 keeps the durable rules distilled out of the log; §13 keeps current status.

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
| Map tiles | **Self-hosted PMTiles archives** read by byte range (`src/lib/map/pmtiles.ts`) | Basemap (Protomaps world + US detail) and the **BTS/NTAD rail network** (`rail.pmtiles`, 66MB, z2-12, STRACNET flagged). All in `~/berwilson-data/maps/` — outside the app dir, so a deploy never deletes them. |
| Deployment | **Mac Studio, tailnet-only** (launchd + `tailscale serve`) | `zsh deploy/deploy-to-studio.sh` from the MacBook. Vercel deleted 2026-07-07; `git push` = GitHub backup only. Crons are launchd agents on the Studio. |

### AI Model Rules (CURRENT — FULLY LOCAL since 2026-07-07)

**The platform is fully self-hosted and fully local-AI as of the 2026-07-07 cutover** (Richard's decision: absolute security, nothing leaves his hardware). Production = the Mac Studio, tailnet-only: app at `https://richards-mac-studio.tail9acc02.ts.net/`, self-hosted Supabase at `:8443`, LM Studio on localhost:1234. **(The MagicDNS suffix changed `tail0e5306` → `tail9acc02` on 2026-09-16 when the tailnet moved to the berwilson.com Workspace org; the Studio is now `100.102.45.39`. Dated entries below still name the old values — that is history, not current state.)**

- **All runtime AI** → `qwen/qwen3.6-35b-a3b` via LM Studio's OpenAI-compatible API (`AI_PROVIDER=local`, `src/lib/ai/local.ts`). Expect ~30–60s on extraction-class tasks (reasoning-heavy model, ~75 tok/s generation).
- **LM Studio load configuration is load-bearing and resets on an eject/reload** — assert it with **`zsh deploy/lmstudio-check.sh`** (`--fix` reloads at the documented settings), which is now part of the deploy runbook. Found drifted to **173,824** on 2026-09-30, costing +1.38 GiB on a box down to 314MB free with 10.7 of 12GB swap in use, for a window the agent cannot reach (`AGENT_CONTEXT_BUDGET_CHARS` caps a conversation near 88k tokens). Settings (2026-09-26): `--ctx-size 131072` with `--cache-type-k q8_0 --cache-type-v q8_0` — the q8_0 cache is what pays for the doubled window, costing +2.12 GiB over 65,536 f16 rather than +5. `AGENT_CONTEXT_BUDGET_CHARS` and `AGENT_DOC_WINDOW_CHARS` in `.env.local` are sized to it and must move with it. **Check `lms ps` after any reload:** a model id ending `:2` means a SECOND 22GB copy is resident (41GB against 36GB of RAM — seen live), and `--parallel` reverts to 4 whatever it was set to.
- **Embeddings** → `text-embedding-qwen3-embedding-0.6b` at its **native 1024 dims**, stored in `vector(1024)` on BOTH `chunks` and `thread_chunks`. The width lives in ONE place — `EMBEDDING_DIMS` in `src/lib/ai/local.ts` — and must equal the schema; when they match, `localEmbedding` returns the model's vector untouched (the truncate+renormalize branch only runs if `EMBEDDING_DIMS` is deliberately made narrower). **Never mix embedding models OR widths** — either change means wipe + re-embed BOTH tables (`deploy/reembed.mjs`), never one of them. **A chat model, by contrast, is swappable at will**: nothing is fine-tuned, all knowledge is in Postgres, so a better `LOCAL_AI_MODEL` costs nothing to adopt.
- **Company knowledge base** → fed by the nightly Drive sync over `GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID` (142 of 154 live `is_company` documents; email attachments NEVER land here — `importThreadAttachments` returns 0 for any thread not linked to a project or opportunity). `documents` now carries `excluded_at`/`excluded_reason` (a human's "not knowledge" — the ROW IS THE TOMBSTONE, §12) and `filing_confirmed_at` ("it is right where it is"). Re-file with `refileDocument` in `src/lib/documents/refile.ts`, which re-points chunks and never re-embeds.
- **Office files** → read directly, no model call: `.docx` via mammoth, `.xlsx` and `.pptx` via `fflate` over the OOXML (`src/lib/ai/document-text.ts`). pptx was added 2026-09-27 — before that `documentKind` had no branch for it and decks were skipped with no `documents` row created at all.
- **PDFs** → local text extraction via `unpdf` (no model call for transcription). **Scanned PDFs and images → Apple Vision OCR** (`bw-ocr`, `scripts/ocr/card-ocr.swift`), spawned like whisper.cpp: renders each page at 200 DPI and recognizes it. No model, no RAM held resident, nothing leaves the machine — the 11-page scanned Alaska mining lease read in **3 seconds**. **A vision LLM is deliberately NOT used and there is no room for one:** the box is 36GB, llama-server holds 19.7GB of weights plus 5GB of KV cache, Colima reserves 3GB, and swap already runs full. OCR is also simply better at dense printed text.
- **Web research / enrichment** (`research.ts`) → blocked in local mode unless `LOCAL_ALLOW_WEB_RESEARCH=true` (uses Gemini + Google Search; only the query leaves, never platform data). Currently ON — Richard kept the Gemini key for the Enrich Profile buttons on contacts/vendors (verified live 2026-07-07).
- The Gemini path in `gemini.ts` still exists behind the flag but is dormant; cloud Supabase project `qauclkrdejgtpywqixho` is **paused** (restorable safety net); the Vercel project is **deleted**. Every AI call still logs to `ai_queries`.

Anthropic Claude is not used at runtime (removed 2026-06-22).

**The dormant Gemini path.** `gemini.ts` still exists behind `AI_PROVIDER` and only web research reaches it today (`gemini-2.5-flash` + Google Search grounding in `src/lib/ai/research.ts`). Its pre-cutover roles — flash for extraction/classification/summarization, pro for the agent loop, `gemini-embedding-001` at 768 dims for RAG — are history; see the log. The cloud Supabase project `qauclkrdejgtpywqixho` is **paused** (restorable safety net) and the Vercel project is **deleted**.

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
│   ├── calc/                 # Quick calc scratchpad (state in the URL, engine runs in-browser)
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
│   ├── economics/            # the deal economics ENGINE (pure, sibling-only, browser-safe) +
│   │                         #   db/store/collections/access/extract. `index.ts` exports only the
│   │                         #   pure half, so `npm test` and the verify scripts need no database
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
- `activity_log` is append-only — no UPDATE/DELETE policies, ever. **A DELETE therefore survives itself**: `log_activity()` writes `to_jsonb(old)` into `metadata`, so a hard-deleted row is recoverable from the log. As of 2026-09-30 the trigger also does a **generic column-by-column diff** for twenty governance tables (named in `_audited_in_full` inside the function) — gated to a list, because `documents`/`updates` carry hundreds of KB of text and diffing those would store both copies on every edit.
- `updated_at` auto-maintained by trigger; tracked tables auto-insert into `activity_log` via trigger.

### Table groups (read database.ts for columns)
- **Core CRM:** `projects` (with `parent_project_id` hierarchy, `bid_due_date`, `win_probability`, capture fields), `project_players`, `milestones`, `updates`, `documents`, `dd_items`, `financing_structures`, `compliance_items`, `project_dependencies`.
- **Tasks (2026-06-25):** `tasks` (real task model — title/what/why/how/assignee_id/project_id/due_date/status/completed_at), `task_notes` (per-task notes feed), `team_members` (assignee list, seeded Richard/Eric). Replaces the old `updates.action_items` JSON for the task UI.
- **Shared children (2026-09-23):** `project_players`, `milestones`, `dd_items`, `financing_structures`, `entity_projects`, `compliance_items` and `research_artifacts` hang off **either** a project or an opportunity — nullable `project_id` + nullable `opportunity_id`, with a check constraint (exactly-one for the first five, at-most-one for the last two). `milestones.stage` is plain **text**, not the `project_stage` enum, so one table carries both pipelines. Never assume `project_id` is set on these.
- **Directory:** `parties` (people + orgs via `is_organization`), `contact_aliases` (uniqueness is on the generated `alias_key` = `lower(alias)`; conflict on `alias_key`, never `alias`), `entities` (legal entities/vendors), `entity_projects`, `party_entities`, `certifications`.
- **Capital raise (2026-07-10):** `investors` (relationship pipeline, links to `parties`), `investments` (investor × target), `investor_notes`. **`target_kind` is company | project | `spv`, and an spv-targeted row sets `spv_id` → `project_spvs` with `project_id` NULL** (2026-10-08) — the deal is reached THROUGH the vehicle, which is the only way a commitment can attach to an opportunity at all. `spv_entity_id` is **dropped**: it pointed at `entities`, the legal company, so the same LLC on two deals made the pointer ambiguous. ⚠ **`investments` IS THE RAISE PIPELINE AND `project_spv_participants` IS THE CAP TABLE** — who we are talking to vs who holds what. They join on `investor_id`, are shown side by side with the overlap counted, and are NEVER summed: the same dollar legitimately sits in both.
- **Steel CRM (2026-07-25):** `steel_deals` (prefab steel deal pipeline: quote→engineering→order_placed→delivered→paid, lead source, salesperson FK→team_members, sqft/$SF/value), `steel_deal_notes`. Own role `steel_sales` sees only this module.
- **Dino (2026-07-28):** internal operating company (acquired plumbing/HVAC co, dinoservicepros.com — NOT a vendor). `dino_revenue` (source_type internal|external; internal → FK project_id, external → client_name; per-job or periodic lump), `dino_payments` (the $150k/12-mo obligation schedule), `dino_notes`. Tracks the internal-vs-external revenue split (show Dino its revenue increasingly comes from Ber Wilson) + money we owe them. Admin-only. See build-status.
- **Land (2026-09-28):** `project_parcels` (the parcels a project or opportunity is made of — county parcel id, TWO acreage columns for the deal's figure and the assessor's, status, zoning, GeoJSON Polygon/MultiPolygon + centroid). Geometry is imported by parcel id from Utah AGRC's per-county LIR layers (`src/lib/parcels/agrc.ts`), never traced. Absent from the generated types, so it uses the untyped-client convention above.
- **Lead routing (2026-09-30):** `lead_categories` — THE registry of lines of business, one row per lane. Carries `destination` (project | opportunity | steel_deal | handoff | manual), `routing_rule` (read to the triage model verbatim), `handoff_email`, `drive_folder_id`, `share_with`, `publish_sheet`, `tone`, `active`, `system`. **`leads.route` is an FK to `lead_categories.key`** with `on update cascade` (a rename carries its leads) and no delete rule (a lane with leads cannot be deleted — that is what `active=false` is for). Adding a line of business is an INSERT at `/settings/lead-categories`, never a code change. Absent from the generated types, so it uses the untyped-client convention above.
- **Vehicles / SPVs (2026-10-06):** `project_spvs` is the SPVs a deal is held in — a child of the **project or opportunity** (shared children, `unique nulls not distinct (project_id, opportunity_id, label)`), **not of the economics model**, so the structure is settled before anything is priced and survives a model being rebuilt. `purpose` is land | energy | data_center | housing | other; nullable `org_node_id` links it to the corporate chart with `org_node_name` snapshotted beside it; `raise_target` is a goal and never a rollup. `project_spv_participants` is the ledger that answers participants, equity splits AND capital raise at once — one row per holder with `equity_pct`, `capital_committed`, `capital_funded`, a nullable `investor_id` seam to the raise machinery, and **`is_ber_wilson`, a FLAG and never a name match**, with at most one per vehicle. **Our share is DERIVED** by `resolveBwShare` in `src/lib/spvs/ownership.ts`: the flagged row when a ledger exists, the typed `bw_ownership_pct` when it does not, and it reports WHICH it read. A ledger with no flagged row is **undetermined, never the residue of the others**. `economics_lines.spv_id` points here. Absent from the generated types, so they use the untyped-client convention above (`spvDb()` / `spvDbAs()` in `src/lib/spvs/db.ts`).
- **Deal economics (2026-10-05):** ten tables answering "how big is this deal, and how much of it is ours". `deal_economics` is one model per project or opportunity (shared children, `unique nulls not distinct` on the parent pair) carrying the deal-level rates and the computed rollups; `economics_capacity_sources` (nameplate, availability, and block designs — 24 blocks of 50 MW at N+4 is 1,000 MW firm, not 1,200), `economics_buckets` (the allocation ledger), `economics_lines` (13 line types in sparse TYPED columns, not jsonb), `economics_line_schedule`, `economics_provenance` (per FIELD: status, source, as-of), `economics_versions` (jsonb snapshots), `economics_benchmarks` + `economics_templates` (registries), `economics_input_proposals` (AI-staged, human-confirmed). **`line_type` is a CHECK and deliberately NOT a registry** — each type is a formula in `src/lib/economics/lines.ts`, so adding one is necessarily a code change. (`economics_spvs` was dropped 2026-10-06 and replaced by `project_spvs` above, with its parent changed.) Eight of the ten carry the audit trigger; `economics_versions` and `economics_input_proposals` do not (see §12 and the `commitments` precedent). Absent from the generated types, so they use the untyped-client convention above (`calcDb()` / `calcDbAs()` in `src/lib/economics/db.ts`).
- **Pipeline value (2026-10-05):** `projects.economics_capture_value` / `economics_status` / `economics_computed_at`, and the same three on `opportunities`. **The name IS the definition:** that column is Ber Wilson NET capture and nothing else. `estimated_value` survives as whatever a human typed and is never overwritten; both are read through `pipelineValue()` in `src/lib/economics/pipeline.ts`, which returns the figure AND which quantity it is. Nothing reads `estimated_value` directly any more.
- **Company:** `company_profile`, `media`.
- **Governance (2026-09-30):** twelve tables behind `/company/people|governance|compliance`, all admin-only by prefix default-deny. **Personnel:** `personnel` (the EMPLOYMENT record — a fifth people-concept on purpose: `parties` is a contact, `org_people` is a box that holds vacant seats, `team_members` is a login; `status` is GENERATED from `separated_on`), `personnel_notes` (+ `personnel_note_kinds`, a registry with an FK, never a CHECK), `personnel_agreements`, `personnel_offboarding` (steps store their own `label` as text so a template change never retitles history). **Corporate record:** `resolutions` (a `written_consent` may not cite a meeting — a CHECK), `org_roles` (appointments + signing/banking authority, effective-dated; NULL `signing_limit` = unlimited), `ownership_interests` (cap table + transfer chain; `org_node_id` is ON DELETE **RESTRICT**). **Compliance:** `entity_obligations`, `conflict_disclosures` (`has_conflicts` NOT NULL — a "nothing to disclose" return IS the record), `related_party_transactions`, `policies`, `policy_acknowledgements`. Absent from the generated types, so they use the untyped-client convention above (`govDb()` / `govDbAs()` in `src/lib/governance/db.ts`). Six of them are edited through ONE spec-driven renderer + ONE dynamic route pair (`src/lib/governance/registers.ts`, `/api/governance/[register]`) — the field whitelist there is a security boundary, not a convenience.
- **Correspondence routing:** `record_identifiers` (2026-09-25 — parcel numbers and owning entities learned from a human filing decision, matched by the router like a solicitation number; see `src/lib/email-sweep/identifiers.ts`). `kind` is a CHECK and gained **`meeting_title`** 2026-10-08, so a recurring deal call files itself from its second occurrence — matched WHOLE by `matchLearnedMeetingTitle`, never by containment, and `loadIdentifiers()` is filtered to parcel/party so the mail router cannot see these. `thread_links` carries TWO cursors — `applied_message_count` for text, `attachments_through` for documents.
- **Meetings (2026-10-08):** `meetings` is the register BOTH the hand-typed form and the Meet importer write to — `search_meetings` / `get_meeting_content` read it and nothing else. `scope` is company | project | opportunity | **`unfiled`** (a real call not yet attached to a deal; deliberately not `company`, which is the governance register at `/company/board`). Idempotent on `drive_file_id` (a PARTIAL unique index, so never an `ON CONFLICT` target). `status` stays `draft` until a human approves. Helpers in `src/lib/meetings/record.ts`. `email_intake_sessions.source_title` holds the title the ORGANIZER typed, apart from the model's rewrite in `extraction_result.title` — the first is the filing key, the second is for reading.
- **AI / intelligence:** `ai_queries`, `chunks` (pgvector), `agent_conversations`, `agent_messages`, `research_artifacts`, `review_queue`, `risk_scores`, `proposal_intake_sessions`, `stored_briefs`, `portfolio_briefs`.
- **Microsoft Graph:** `email_tokens` (OAuth — calendar/enrichment/email research).
- **Protected projects (2026-09-30):** `projects.confidential` (boolean, default false) + `step_up_sessions` (auth_user_id × project_id, absolute 30-min expiry, `factor_id`/`ip`/`user_agent` for the audit trail). `confidential` is CONTAINMENT and applies to everyone including both admins — the project leaves every cross-portfolio surface, all portfolio-wide retrieval, and every OUTBOUND channel (brief, Pepper, digests, notifications, Drive publish, Google Tasks). A step-up is ACCESS and only opens its own pages. `step_up_sessions` is absent from the generated types, so it uses the untyped-client convention above. Everything goes through `src/lib/security/` — `confidential.ts` (no cookies, so crons can import it), `request.ts` (viewer-aware), `guard.ts` (routes with a project id in the BODY), `mfa.ts`, `path.ts`, `audit.ts`.
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
LOCAL_AI_STREAM_FIRST_CHUNK_TIMEOUT_MS= # optional; wait for the FIRST streamed chunk (default 900000). Prompt processing streams nothing, so this must be far larger than the gap cap below — a full 131,072-token window is ~610s of silence at the measured ~215 tok/s prefill
LOCAL_AI_STREAM_IDLE_TIMEOUT_MS= # optional; gap cap BETWEEN chunks once streaming has started (default 180000)
LOCAL_AI_TIMEOUT_MS=             # optional; cap on response HEADERS only (default 900000). With stream:true they arrive in 0.1s, so a wait here means LM Studio is not answering at all
LOCAL_SUMMARY_INPUT_CHARS=       # optional; document chars fed to a SUMMARY pass (default 30000). Deliberately not raised with the window — a summary only has to say what a document is so the agent opens it
LOCAL_PDF_TEXT_MAX_CHARS=        # optional; cap on STORED document text (default 2000000). Was 240000 and silently truncated real documents; no longer a context guard since reads are windowed
OCR_DPI=                         # optional; render resolution for scanned PDFs (default 200). 72 reads body text but is marginal on small print
OCR_MAX_PAGES=                   # optional; page ceiling per scanned document (default 300)
OCR_DOCUMENT_TIMEOUT_MS=         # optional; whole-document OCR cap (default 900000)
CRON_SECRET=                     # Bearer auth on cron routes; launchd cron agents on the Studio send it
APP_URL=                         # tailnet base URL for links in outbound notifications (Pepper's "Open my tasks" / "Open the Decide queue")
SUPABASE_DB_URL=                 # ⚠ ASPIRATIONAL — nothing reads this, and `npm run gen-types` is a disabled stub. See §4
MAP_PMTILES_PATH=                # optional; /map detail basemap archive (default ~/berwilson-data/maps/us.pmtiles)
MAP_WORLD_PMTILES_PATH=          # optional; /map world-overview archive z0-7 (default ~/berwilson-data/maps/world.pmtiles)
MAP_RAIL_PMTILES_PATH=           # optional; /map rail-network archive z2-12 (default ~/berwilson-data/maps/rail.pmtiles). UNSET AND ABSENT = the route 204s and the layer draws nothing — deliberately not a 503. Rebuild with `zsh scripts/setup-rail-data.sh`
CARD_OCR_BIN=                    # optional; business-card OCR binary (Apple Vision). Default ~/.local/bin/bw-ocr — build with `zsh scripts/build-ocr.sh`
BACKUP_DIR=                      # optional; nightly-backup dir the health page checks (default ~/Backups/berwilson)
GOOGLE_LEAD_MAILBOXES=           # mailbox(es) swept for INBOUND LEADS (default info@berwilson.com) — kept apart from the deal mailboxes
GMAIL_LEAD_EXCLUSIONS=           # optional; overrides the LEAD sweep's Gmail-side marketing filter (default: -category:promotions -category:social -label:bw-filtered)
GMAIL_DEAL_EXCLUSIONS=           # optional; the same filter for the DEAL sweep (moose@/tuaone@), added 2026-09-22. Same default. Applying the `bw-filtered` Gmail label to a sender retires them with no code change
LEADS_NOTIFY_EMAIL=              # optional; where scored leads are announced. UNSET = nothing is sent (the queue still fills)
GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID=# optional; COMMA-SEPARATED Drive folder ids indexed nightly into the company KB (nested subfolders included, "Archive" skipped). UNSET = sync no-ops. Nominating folders IS the control model — never point it at a drive root
GOOGLE_DEAL_INTAKE_FOLDER_ID=  # optional; Drive parent the berwilson.com deal form creates one folder per submission inside. UNSET = deal intake off (cron 503s). Contract: deploy/deal-intake-form.md
GOOGLE_MEET_FOLDER_ID=           # optional; where Meet files recordings/transcripts. UNSET = resolve a folder named "Meet Recordings" OR "Google Meet" in each exec's own Drive. Add to MEET_FOLDER_NAMES rather than setting this (§12)
DINO_LEAD_EMAIL=                 # ⚠ SUPERSEDED 2026-09-30, read by nothing. Handoff addresses live on the
                                 # `lead_categories` row now — set them at /settings/lead-categories
GOOGLE_CHAT_WEBHOOK_URL=         # optional; Chat space lead digests are ALSO posted to. Carries its own auth token — treat as a secret. UNSET = email only
GOOGLE_CHAT_WEBHOOK_URL_<KEY>=   # optional; a second space, addressed by <KEY> (e.g. STEEL) without touching the notify layer
LEAD_MAILBOX_HYGIENE=            # optional; "off" stops the platform unsubscribing from marketing and spamming junk in info@. Unset = ON. Scoped to the LEAD mailbox only — moose@/tuaone@ are Eric's and Richard's own and hold read-only Gmail scopes anyway
LEAD_GMAIL_LABELS=               # optional; "off" stops writing the triage verdict back as a Gmail label on info@ threads. Unset = labelling ON
LEAD_DRAFT_REPLIES=              # optional; "off" stops drafting replies to pursue leads. Unset = drafting ON (a draft is never sent)
STEEL_QUOTES_FOLDER_ID=          # optional; the team's own Drive folder quote PDFs are filed into. UNSET = quotes stay in the platform's own deal folder. Works under drive.file only because it is a SHARED DRIVE folder (§12)
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
- **A project may be marked `confidential` (2026-09-30), which demands a TOTP step-up to open and keeps it out of every aggregate and every outbound channel.** TOTP is served by the LOCAL gotrue container — nothing leaves the box, and there is no shared secret in the system. Only an **admin** can hold a step-up, deliberately including over an explicit `access_grant`. **Enrol at `/settings/security` BEFORE protecting a project**, or the only way back in is to clear `step_up_sessions`/`confidential` by hand in psql. ⚠ This is NOT a compliance control: the CUI rule below is unchanged, and a 6-digit code is not CMMC L2.
- `documents.classification` flags standard vs sensitive. All AI calls logged to `ai_queries`.
- US-only infrastructure. **Do not store CUI** until a GovCloud migration is done. GovCloud trigger: annual DoD revenue > $2M OR a contract requiring CMMC L2. Stack is portable by design (standard Postgres, no vendor lock-in).

---

## 9. KNOWN DEBT / AUDIT NOTES

The debt that is still live. (The resolved entries — scope sprawl, overlapping attention surfaces, type drift, speculative features, legacy `action_items` — are in [`docs/BUILD-LOG.md`](docs/BUILD-LOG.md) under 2026-07-03 and 2026-07-12. **One standing instruction survives them:** the Equity & Valuation and Portfolio site-hierarchy modules, background checks, vendor scorecards and the Procore stub were removed deliberately, ~13.5K lines. If a CFO joins and needs finance tools, build a fresh purpose-built section — do not resurrect the old ones.)

- **Two directory concepts.** The *surface* is consolidated (2026-07-03: one nav destination, `/contacts` = "Directory" with Contacts | Vendors & Contractors tabs via `?tab=vendors`; the `/vendors` list redirects there, detail/new routes stay). The *data model* is still two tables (`parties` + `entities`); a full merge into `parties` is optional future work — only if the split causes real pain.
- **`team_members` is a 4th people-concept**, kept tiny for fast task assignment. Partly reconciled 2026-07-21: `team_members.party_id` links a task owner to their `parties` contact, so owner and contact are one person. Tasks keep `assignee_id → team_members.id`; full merge only if the split hurts.
- **Pre-existing lint noise** (recount 2026-10-05, **19 problems — 13 errors, 6 warnings**; it had drifted to 27 on six `any` escapes in scripts, a `prefer-const` and an unused var, all now fixed): two `react-hooks/purity` errors in `src/app/dashboard/page.tsx` (`Date.now()` in a server component — rule misfire, runtime fine); 11 `react-hooks/set-state-in-effect` (load-on-mount fetch / localStorage hydration / sync-form-on-modal-open — each needs a per-component rewrite to satisfy the React Compiler; deliberately left, they work); 6 `@next/next/no-img-element` warnings (switching to `next/image` needs `remotePatterns` config; do it if image cost/LCP ever matters).
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

- **`.or()` takes a LOGIC TREE, not a list of values.** An unescaped comma in a user or model value parses as a condition separator, the query dies, and callers swallow it into "no results". Build every such filter through `orIlike`/`orIlikeAnyWord` (`src/lib/utils/postgrest.ts`). **QUOTING IS THE DEFENCE; STRIPPING IS NOT** — a double-quoted value carries `( ) , . ' / &` as text, so only `"`, `\` and `*` need removing, and stripping more LOSES matches (`Arthur P. Valencia` and `Paul Hunsaker (Vancon Inc.)` were unfindable by their own names). Unquoted parentheses are the silent case: they parse as grouping and return an EMPTY SET with no error. — 09-23, 10-05
- **Never `::` cast inside a PostgREST filter.** `.or()` rejects the cast outright; a plain `.filter()` silently drops it and hands raw jsonb to the operator. Use `->>` / `->`. — 08-28
- **Adding a second FK to an already-embedded table breaks EVERY existing embed of it** (PGRST201). Hint the constraint name at all call sites — `team_members!tasks_assignee_id_fkey`. `tsc` catches at most one of them. — 07-13
- **`.neq()` is NULL — and therefore not true — for a NULL column**, so a nullable status silently hides rows from every reader that filters on it. Make the column NOT NULL, or handle NULL explicitly. — 09-23
- **A `.neq()`/`.eq()` VALUE THAT IS NOT IN THE ENUM FAILS THE WHOLE QUERY, NOT THE ROW** — `22P02` and a NULL row set, so a record picker rendered half its records with no error on screen. Check the enum's members before filtering on one. — 09-29
- **`ON CONFLICT` cannot use a partial unique index** — PostgREST has no way to repeat the predicate. Postgres already treats NULLs as distinct, so the predicate is usually unnecessary anyway. — 09-09
- **A UNIQUE INDEX on an EXPRESSION is not a conflict target PostgREST can name.** `onConflict: 'alias'` against `unique(lower(alias))` fails every call. A UNIQUE CONSTRAINT cannot sit on an expression either — add a generated stored column and constrain that. — 09-24
- **`unique (a, b, c)` WHERE ONE COLUMN IS ALWAYS NULL ENFORCES NOTHING.** The shared-children convention (§4) puts NULL in exactly one of `project_id`/`opportunity_id`, and two NULLs are never equal — so the constraint matches nothing, `ON CONFLICT` never fires, and every re-import stacks another copy of the whole set. `unique nulls not distinct` (PG 15+). — 09-28
- **A RECORD THAT CARRIES FACTS OF ITS OWN MUST NOT HANG OFF SOMETHING REBUILT MORE OFTEN THAN IT IS.** `economics_spvs.economics_id` was `not null … on delete cascade`, so an SPV could not exist before an economics model and died with one — fine for a modelling input, fatal once the vehicle carried a cap table and committed capital. Ask what the child OUTLIVES before choosing its parent; the answer is usually the record a human thinks of it as belonging to. — 10-06
- **Adding a discriminator column means checking for a CHECK constraint on it.** A new value typechecks, deploys, then fails at every INSERT. ⚠ **AND THE COLUMNS A DISCRIMINATOR GOVERNS MUST TRAVEL TOGETHER ON EVERY PARTIAL WRITE**, or switching an `investments` row from a vehicle back to the parent company sends `target_kind` alone, leaves the old `spv_id` in place and fails the CHECK — a 500 the reader reads as their own mistake. Name the group (`TARGET_COLUMNS`) and write all of it whenever the discriminator moves. — 09-19, 10-08
- **A CHECK CONSTRAINT IS A LIST BAKED INTO THE SCHEMA; AN FK POINTS AT ROWS. IF THE VALUE SET WILL GROW WITH THE BUSINESS, IT IS A TABLE.** `leads.route` as five CHECK literals meant a migration, a TypeScript union, five label maps and five paragraphs of prompt prose per new line of business. Two rules on the replacement FK carry the lifecycle: **`on update cascade`** so a rename carries its rows, and **no delete rule** so a category with rows cannot be deleted — which is what an `active` flag is for. — 09-30
- **ADDING AN ARGUMENT TO A FUNCTION OVERLOADS IT; `create or replace` DOES NOT REPLACE IT.** Both signatures then match an 8-named-argument PostgREST call, which answers `function is not unique` — and a wrapper's legacy-signature retry path falls back to the version WITHOUT the new filter, so a security filter added this way fails OPEN. Drop the old signature in the same migration and assert `pg_proc` holds exactly 1. — 09-30
- **AN EXCLUSION MUST BE APPLIED IN SQL, BEFORE THE `LIMIT` — NEVER IN THE CALLER AFTERWARDS.** A ranking's `LIMIT` runs first, so twenty withheld passages at the top return an EMPTY answer rather than the next twenty real ones — and empty reads as "there is nothing on file". Post-filter as a backstop, never as the mechanism. — 09-30
- **A table created by a migration applied as anything but `postgres` gets NO API GRANTS.** The default privileges hang off `postgres`, so a table owned by `supabase_admin` receives none — every PostgREST call answers `42501`, and `postgres` cannot even grant on it afterwards. Apply migrations as `postgres`; if a feature "does nothing", check `information_schema.role_table_grants` before reading its code. — 09-24
- **`pg_stat_user_tables.n_live_tup` IS A STALE ESTIMATE** — it reported `projects` at 1 against a real 15. Never let it drive a decision; `count(*)`. — 09-24
- **PostgREST truncates at 1000 rows, silently.** Paginate any select that could exceed it. — 09-22
- **A multi-row insert is ONE statement with a uniform column list.** Rows that omit a column get an explicit NULL, not the default. Hit again on `economics_lines`, where four NOT NULL booleans made it fail loudly — which is the GOOD case; the bad one is a nullable column silently nulled on half the rows. Give every writer one helper that returns the full column set. ⚠ **THE MIRROR IMAGE IS WRONG FROM A SINGLE REQUEST BODY: a field the caller never mentioned must be OMITTED, not nulled**, because an explicit NULL does not fall back to the column's DEFAULT — it violates its NOT NULL. A whitelist normalizer that nulled every absent field meant "Add a capacity source" and "Add an allocation bucket" had **never once worked**, each answering a 400 a reader reads as their own mistake. *Absent* means "the caller did not say"; `''` still means "the reader cleared it". — 09-15, 10-05, 10-06
- **Never `NULL || array`** on a bucket's `allowed_mime_types`: NULL means unrestricted, and the concat collapses it to just the appended list — silently rejecting every other type platform-wide. — 07-28
- **Never string-compare a Drive `modifiedTime` against a stored `timestamptz`** — PostgREST round-trips with an offset (`…Z` vs `…+00:00`), so they are never equal. Compare instants. — 09-05
- **A LIST CAPPED AND SORTED `nullsFirst:false` DROPS EXACTLY THE NEWEST RECORDS FIRST.** A lead with neither bid date nor fit score sorts dead last, which is precisely a just-created one — so a deep link seeded from that window opens nothing for the one record it was about. Fetch a deep-linked id explicitly. — 09-29
- **AN INSERT THAT WAS SAFE ONLY BECAUSE THE PARENT WAS BRAND NEW BREAKS THE MOMENT THE SAME PASS CAN TARGET AN EXISTING ONE.** `project_players` inserted with no error check is a `unique (project_id, party_id, role)` violation as soon as the destination can be a curated record. Read the roll first, skip what is there, COUNT the skips — and re-read every insert in a pass when you add a destination to it. — 09-30
- **A DELETE ROUTE ON A PERSON IS ALMOST ALWAYS THE WRONG VERB, AND A STATUS SET WITH NO "DEPARTED" MEMBER IS WHAT FORCES IT.** `org_people.status` offered only `active | open`, so the delete route obliged: the row vanished with no date, no reason, no audit row. `team_members` was worse — its delete took the auth login and CASCADED `access_grants`. Keep the row, flag it, let "who works here" be a read over rows with no end date. ⚠ A CHECK CONSTRAINT WITH NO ARM FOR THE UNDECIDED STATE DOES THE SAME THING: `meetings` allowed company/project/opportunity only, so an imported call naming no deal could only be filed as `company` — which is the governance register. Add the arm (`unfiled`), do not borrow one. — 09-30, 10-08
- **A CASCADE DESTROYS THE EVIDENCE OF WHAT A REVOKED CREDENTIAL COULD REACH, SO SNAPSHOT IT AT THE STEP THAT ALWAYS HAPPENS FIRST.** Deactivation always precedes deletion, so the grants are copied into `team_members.revoked_grants` there. When a child table is the only record of a permission, preserve it at the first irreversible step, not the last. — 09-30
- **A PASS THAT REPORTS WHAT IT DID MUST READ BEFORE IT WRITES, OR IT CLAIMS WORK IT DID NOT DO.** The separation pass announced *"org chart marked departed"* on a second run having changed nothing: idempotent and honest are different properties, and the value of an `applied` list is that the reader can believe it. Pair every fill-not-overwrite pass with a script that calls it TWICE and asserts the second run reports nothing. — 09-30
- **A `superseded_at` THAT THE SOURCE WILL UN-SET IS NOT A RETIREMENT, AND A DELETE THE SOURCE WILL REPLACE IS NOT A DELETE.** A hard DELETE left the Drive file in its nominated folder and it re-imported that night; a retire was read as `returning` and handed to `restoreDocument()`, actively undoing the decision. THE ROW IS THE TOMBSTONE — keep it, flag it (`excluded_at`), and **check the flag BEFORE the restore branch**. — 09-30
- **A UNIQUENESS OR OWNERSHIP CHECK MUST READ EVERY TABLE THE THING CAN LIVE IN.** `drive-sync`'s `ownedElsewhere` read `documents` and never `opportunity_documents`, so a file already filed on an opportunity was re-claimed as company knowledge — two rows, two sets of chunks, nothing reporting it. The parallel-table split (§9) means "is this already imported" is always TWO questions. — 09-30
- **RE-FILING A DOCUMENT RE-POINTS ITS CHUNKS; IT DOES NOT RE-EMBED THEM.** The text does not change when a document moves, so the stored vectors are exactly valid at the new address — instant and EXACT, where rebuilding is hours of contended GPU for no change in the numbers. **In a cross-table move the ORDER is load-bearing:** `chunks.document_id` is `ON DELETE CASCADE`, so deleting the source row first destroys the vectors. Do not copy the storage object. — 09-30
- **A COMPUTED QUEUE NEEDS A WAY TO RECORD "IT IS RIGHT WHERE IT IS", OR IT CAN NEVER REACH ZERO.** Deriving a queue from the records is right — it cannot go stale — but a dismissal that is not written down reappears on the next page load, and a queue that cannot be finished teaches people to ACCEPT rows to clear them. `filing_confirmed_at` changes nothing about the document and is the whole reason the queue is drainable. — 09-30
- **`bestMatch` READS `summary.deal_name` IN PREFERENCE TO ITS OWN `subject` ARGUMENT** (`summary?.deal_name ?? subject`), so a richer subject passed alongside a summary carrying a `deal_name` is silently discarded — three documents returned NO MATCH inside the function while matching at 0.99 in isolation with identical inputs. Compose ONE name and pass it to both. Worth 17 proposals → 21 and 101 chunks → 298. ⚠ **BUT WHEN A MODEL REWRITES A LABEL, THE REWRITE AND THE ORIGINAL ARE TWO NAMES DOING TWO JOBS AND MUST BOTH BE KEPT** — a Meet invitation read `Ber Wilson / Zenthium` and the extraction retitled it "Steelton & Riverdale Site Reviews & Power Capacity Analysis". The original is what a MATCHER files on, because it is the string the next one arrives under; the rewrite is what a HUMAN reads. Learning the rewrite stores a key nothing can ever present, and the table fills with plausible rows while the matcher misses. — 09-30, 10-08
- **THE FOLDER IS OFTEN THE ONLY PLACE THE DEAL IS NAMED, AND THE IMPORTER ALREADY HAD IT.** `drive-sync` used `file.path` in its notification and dropped it from the row, so 142 company documents had no origin to show, group or match on. Note `listFolder` returns paths RELATIVE to the folder it was handed, so a file sitting directly in a nominated folder comes back as an empty string — prefix the nominated folder's own name. — 09-30
- **Check what a table CONTAINS, not just how many rows it has, before calling it unused.** — 09-22
- **A blank spreadsheet cell is ABSENT from the XML, not empty in it.** Reading `<c>` elements in sequence without honouring each one's `r="C12"` reference shifts every value after a gap one column left — silently pairing a claim number with the wrong section. — 09-26
- **NEVER USE A TYPESCRIPT PARAMETER PROPERTY IN `src/lib`.** Node's strip-only type stripping refuses `constructor(private x: T)` with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Next compiles it fine, so it typechecks, builds and deploys; what breaks is every verification or backfill script that would import the module. A shared lib no script can load is one nothing can verify. Plain fields. — 09-30
- **THE TRAPEZOID AREA AND THE CROSS-PRODUCT CENTROID HAVE OPPOSITE SIGNS.** Dividing a cross-product centroid sum by the trapezoid area negates both coordinates, and a parcel in Utah imports in the ocean off Western Australia. Nothing reports it — the geometry is stored raw and draws perfectly, so only the fly-to target is wrong. Assert the centroid falls inside its own bounding box. — 09-28

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
- **A STATUS COLUMN'S CONTRACT BELONGS TO THE FUNCTION THAT DOES THE WORK, NOT TO EACH CALLER.** `embedOpportunityDocument` inserted chunks and left `embedding_status` at its `pending` default — the UI's "Indexing…" forever — while `embedDocument` settled its own. Three of four callers remembered; the fourth left an indexed document reading as unindexed, and nothing reported it. Both settle their own now. — 09-28, 10-05

### Next.js / React

- **Helpers shared between server pages and client components live in `src/lib`** — never exported from a `'use client'` file. Every export of a client module becomes a client reference; calling one from a server page throws at REQUEST time, and `tsc`/build do not catch it. — 07-11
- **A LAYOUT IS NOT A DATA BOUNDARY.** A layout and the page inside it render in PARALLEL, so a layout showing a gate has not stopped the page beneath it fetching the record. Gate in `middleware.ts` with `NextResponse.rewrite`, which replaces the tree before any of it runs and keeps the URL — **and the gate's destination must be a SIBLING of `[id]`, not a child**, since `projects/[id]/layout.tsx` selects most of what the gate exists to withhold. — 09-30
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
- **A PIPELINE'S EXIT STATUS IS THE LAST COMMAND'S, SO `npm run build | grep … && launchctl kickstart` RESTARTS ON A FAILED BUILD.** grep matched, grep exited 0, the `&&` fired — and the failed build had already removed `.next/BUILD_ID`, so there was no old build to stay live: the service exited 1 and the platform answered 000. **Capture `$?` from an UNPIPED build and gate on it** (`npm run build > /tmp/build.log 2>&1; rc=$?`), then grep the log. Took production down once. — 09-30
- **THE DEPLOY RUNBOOK BUILDS THE WORKING TREE, NOT `HEAD`, SO A COMMIT THAT DOES NOT COMPILE SHIPS GREEN.** A rename left one import pointing at a deleted module; the migrated file sat uncommitted as the only modified path, so every build and every deploy passed while `main` was broken for four days. A fresh clone is where it surfaces. After committing a rename, verify the COMMIT builds. — 10-03
- **`next start` loads the build at boot.** A rebuild without `launchctl kickstart` changes nothing — three sweep phases ran only by hand for nine days because of this. — 09-20
- **Work fired off after a route handler returns dies with the next `launchctl kickstart`** — and a deploy IS a kickstart. Store what the pass would need to resume and write progress back after every unit, or an interrupted run is indistinguishable from a lost one. — 09-24
- **Do not run a backfill and a deploy at the same time on this box.** If the app 000s after a kickstart, check free memory and the service's exit code (−9 = OOM-killed) before suspecting Supabase. — 09-14
- **Do NOT edit a shell script while it is running** — zsh reads by byte offset, so the running copy resumes at a garbage position and dies with a syntax error that is not there. — 09-23
- **`supabase db push --linked` targets the WRONG database** (the retired cloud project). Apply migrations by piping SQL to `docker exec supabase-db psql` over ssh; back up any table being dropped first. — 08-23
- **TO PATCH AN EXISTING PLPGSQL FUNCTION, DERIVE IT FROM `pg_get_functiondef` AND EDIT IT PROGRAMMATICALLY — NEVER RETYPE IT.** `log_activity()` is 148 lines of per-table diff branches; transcribing it by hand to add one is a silent-corruption risk across the whole audit trail. ⚠ `pg_get_functiondef` emits no trailing semicolon, so the first apply failed pointing 190 lines past the real problem. — 09-30
- **A backup is not a backup until it has been read back** — and its filename needs seconds, or a same-minute retry overwrites the good copy. — 09-15
- **After killing a sweep mid-run, clear `page_token`** or the next cron resumes from that cursor and re-ingests everything. — 09-09

**LM Studio / the local models**

- **Check `lms ps` against the documented config before blaming code** for slow or stalled AI; an LM Studio update resets it. The tell is a model id ending `:2` (a second 22GB copy resident). `parallel` is the costly setting, not context, and `lms unload` takes no `-y` (passing it loads ANOTHER copy). — 09-14
- **LM Studio serves ONE request at a time.** Overlapping crons queue behind each other; that is why the digest is 7:00am and the brief 6:30am. — 09-23
- **`deploy/lmstudio-check.sh --fix` DOES NOT LOAD A MISSING EMBEDDER, WHICH IS THE ONE FAILURE IT CANNOT REPAIR AND THE WORST ONE TO HAVE.** With the embedder unloaded, retrieval returns nothing while chat keeps answering, so Ber AI says *"I found no correspondence"* rather than erroring — indistinguishable from an empty corpus. Load it by hand (`lms load text-embedding-qwen3-embedding-0.6b`, 609MB, ~6s) and re-run the check. — 09-30
- **`lms load --estimate-only` ANSWERS "CAN THIS BOX HOLD MORE CONTEXT", AND HAND ARITHMETIC DOES NOT.** Measured for Qwen3.6-35B-A3B: 23.30 GiB at 65,536 tokens, 25.42 at 131,072 — a 2.12 GiB delta. Hand arithmetic from the GGUF metadata overstated it by more than double, because flash-attention and the MoE layout do not allocate what the naive formula implies. Ask the tool; it knows its own allocator. — 09-26
- **`--parallel` is not a memory lever, though `lms ps` showing 4 invites the assumption.** `--estimate-only` returns the identical figure at 1 and at 4. Set it to 1 because the platform never issues concurrent requests, not to free anything. — 09-26
- **NEVER RUN OCR AND THE LLM AT THE SAME TIME ON THIS BOX, AND UNLOAD THE CHAT MODEL BEFORE ANY RE-EMBED OR BACKFILL.** With the 22GB model resident, swap hit 21.5GB/295MB-free and `bw-ocr` was being killed — 2 documents in 20 minutes. `lms unload` drops wired memory 25.4GB → 4.3GB; the same backfill then did 28 of 34 in ~7 minutes. Neither OCR nor a re-embed needs the chat model. — 09-26, 09-30
- **CHECK THE MACHINE'S MEMORY BEFORE RECOMMENDING A MODEL.** Asked which vision model to load, the honest answer was *none*: free 0.3GB, wired 25.8GB, swap 17.2 of 18.4GB used. Apple Vision OCR — already installed, no model, no resident RAM — read an 11-page scan in 3 seconds. — 09-26
- **A CHAT MODEL IS SWAPPABLE AND AN EMBEDDING MODEL IS NOT, AND THAT ASYMMETRY IS THE WHOLE ANSWER TO "DO WE LOSE ANYTHING BY UPGRADING".** Nothing is fine-tuned — every fact lives in Postgres — so a better `LOCAL_AI_MODEL` is a one-line env change. A stored vector is only meaningful against the model AND the width that produced it, so changing either invalidates every row in `chunks` AND `thread_chunks` at once. No incremental path, no partial one. — 09-30
- **THE EMBEDDER'S NATIVE WIDTH WAS 1024 AND THE SCHEMA WAS `vector(768)`, SO A QUARTER OF EVERY VECTOR WAS DISCARDED — ON EVERY CHUNK AND EVERY QUERY.** Matryoshka training makes the leading slice a valid embedding, so nothing looked broken; retrieval simply ran on 75% of the signal. A truncation that is *legal* still costs accuracy. Check what the model returns against `EMBEDDING_DIMS`. — 09-30
- **A RE-EMBED SCRIPT THAT MISSES AN INDEX IS WORSE THAN NO RE-EMBED SCRIPT.** `deploy/reembed.mjs` covered `chunks` and never `thread_chunks` (6,498 rows), so a model swap would have left two incompatible vector spaces in one database and reported success. It also selected a column that does not exist and read `documents: 0/0` having indexed nothing — a zero from a broken query and a zero from an empty table are the same number on screen. Check `error` on every select, page every one, count the REASON beside the number. — 09-30

**Correspondence routing**

- **A cursor that gates two different jobs gates neither correctly.** `applied_message_count` decided both "what text to post" and "what attachments to import", and every filing path seeds it at the thread's current length so old mail is not replayed as news — which made the attachment slice permanently empty (178 attachments against 30 imported). The text of old mail is not news; a deed is still a deed. Give the second job its own cursor. — 09-25
- **A failure inside a loop must hold the cursor, not just `continue`.** A `continue` past a failed fetch still let the end-of-run advance fire, so the file was lost rather than retried — silently. Gmail's per-MINUTE metering makes this fire exactly when pulling several large attachments in a row. — 09-25
- **A FILE NAME IS NOT EVIDENCE OF SAMENESS, AND NEITHER IS SIZE.** Four parcels' title commitments are all called `Title Commitment - AS.pdf` within 1.1% of each other, so a name rule discards three and any tolerance wide enough for a re-encode discards them too. Hash the bytes; rename the collision after the thing it identifies. — 09-25
- **`isInline` is not sufficient to spot mail chrome — it is the MIRROR of the Content-Disposition rule.** Replying from Gmail re-attaches signature images *as attachments*. The name is what survives: `image001.png` / `ATT00002.png` / `oledata.mso` are client-generated and never a person's file. — 09-25
- **The sender is never the key to which deal mail belongs to.** A title company, a law firm and a bank each work across many deals at once. What identifies the deal is the PROPERTY — a parcel number permanently, the owning entity for the length of a negotiation. Learn those from a human filing decision and match them like a solicitation number. — 09-25
- **A matcher must never learn from its own matches.** Identifiers are read by the router and written only by a human filing act; self-teaching compounds, attaching a neighbouring parcel quoted in a forwarded chain and then filing the neighbour's deal there. Every identifier traces to someone saying "this belongs here", which is what makes a misfiling undoable. — 09-25
- **An extractor that sounds right must still be counted against the corpus.** `summary.counterparty` answered "whose deal is this" with `Carbon County`, `Bank of Utah` and `Richard White` — the reader himself. 164 candidate identifiers became 15 once counterparty was dropped and civic/geographic names banned. A name that many deals share is the one thing an identifier must not be. — 09-25

### Design / process

**Security & containment**

- **CONTAINMENT AND ACCESS ARE DIFFERENT QUESTIONS, AND ONLY ONE OF THEM CAN BE UNLOCKED.** "Is this record protected?" and "may this viewer see it right now?" must not share a function. Anything that LEAVES the box — an email, a Drive file, a push to a phone — can never be unlocked after the fact, so those paths take the absolute answer with no opt-out. Make the parameter explicit (`hiddenProjectIds(authUserId | null)`) so a job that forgets to pass a user gets the SAFE behaviour. — 09-30
- **A SECURITY FILTER BELONGS AT THE CHOKE POINT AS A DEFAULT, NOT AS A PARAMETER EVERY CALLER PASSES.** Forgetting to opt in costs a few results; forgetting to opt out costs the secret, with nothing reporting it. Same reasoning put the check inside `canAccessRecord` rather than the seven routes that call it — and it covers the eighth route added next year. — 09-30
- **WITHHOLDING FROM A MODEL MEANS HANDING IT THE COUNT OF WHAT WAS WITHHELD** — "there are 13 projects" from a list trimmed from 14 is confidently wrong, and worse than saying some are protected. With 42 tools in a dozen result shapes, scrub the RESULT recursively on `id`/`project_id`/`*_project_id` rather than filtering a dozen reads. And a fail-closed `Set` whose `has()` always returns true while `size` is 0 hands a disclosure to any caller writing `if (hidden.size)` — enumerate for real. — 09-30
- **A NULLABLE POINTER ADDED TO A TABLE FILTERED BY A DIFFERENT POINTER BREAKS AN EXISTING SECURITY FILTER WITHOUT TOUCHING IT.** Every outbound surface drops rows with `dropHidden(rows, r => r.project_id, hidden)`. `investments.spv_id` names its deal THROUGH the vehicle, so `project_id` is NULL by design — and a protected deal's committed capital passed straight through into the SENT daily brief, with nothing reporting it and no line of the filter having changed. The shared-children convention (§4) manufactures this shape, so: when a table gains a second way to name its record, grep every reader that filters on the first one. — 10-08
- **`matchesPrefix` is NOT method-aware** — allowlisting a read path grants every mutation under it. Routes carry their own guards regardless. — 09-22
- **User-initiated mutations on tracked tables use `actorAdminClient()`**, not `createAdminClient()`, or the activity log says "system". — 07-03

**Retrieval & the agent**

- **AN AGENTIC LOOP MUST END ON AN ANSWER, WHICH MEANS THE LAST ROUND CARRIES NO TOOLS.** `for (round = 0; round < 5)` then falling out of the bottom shipped the NARRATION as the answer — turns storing *"Let me pull the claim list and lease document."* and nothing else after 6-9 tool calls. Strip the tool declarations on the closing round and require a PARTIAL answer with its gaps named. A budget cliff and giving up mid-sentence look identical from the chair. — 09-26
- **Raising a round budget without a context guard trades one silent failure for a worse one.** Measured: system prompt 17.5k chars + company context 4.9k + 42 tool declarations 30.2k ≈ 13k tokens of fixed overhead per request. Shrink the OLDEST tool RESULTS as the conversation grows, never remove a message: an OpenAI-format `tool` message must keep following the `assistant` message whose `tool_calls` it answers. — 09-26
- **THE KV PREFIX CACHE IS WHY A ROUND IS NORMALLY FAST, AND SHRINKING THE CONVERSATION IS WHAT THROWS IT AWAY.** Measured: the same prefix re-sent returns its first token in 3.2s against 68.3s cold — 21x. So `AGENT_CONTEXT_BUDGET_CHARS` stubbing the oldest tool results invalidates the cache from that point and the next round re-prefills ~88k tokens (~285s) — the cost lands on the longest, best-evidenced turns. Append; do not rewrite, if there is ever a choice. — 09-29
- **PREFILL IS ~308 tok/s UNCONTENDED AND ~215 tok/s BEHIND A CRON** (21,025 tokens → 68.3s; 29,121 → 135.5s while queued). LM Studio serves ONE request at a time, so a cron holding the model is added to the caller's wait — a latency measured while something else runs is measuring the queue. A full 131,072-token window is ~425s of silence before the first token. — 09-29
- **`fetch` HAS A 300s CEILING ON PROMPT PROCESSING THAT NO OPTION IN THIS CODEBASE CAN REACH.** undici enforces its own `headersTimeout` AND `bodyTimeout`, both 300s, neither touched by the `AbortSignal` or `LOCAL_AI_TIMEOUT_MS`. `stream:true` dodges the first and hands the socket to the second: nothing streams while LM Studio ingests, and it dies at five minutes as a bare `TypeError: terminated` (`UND_ERR_BODY_TIMEOUT`). The chat stream goes over `node:http`, which applies no such timeout. — 09-29
- **A TIMEOUT SERVING TWO DIFFERENT WAITS IS SET WRONG FOR BOTH.** The silence BEFORE the first token grows with the conversation; the silence BETWEEN tokens does not (generation holds ~75 tok/s whatever the context). Wait generously for the first chunk, keep the gap cap tight after it. — 09-27
- **A truncating reader with no continuation parameter is not a reader.** `get_document_content` returned `slice(0, 20000)` and `truncated: true` with no way to ask for the rest — 8% of a 240,000-char report. The agent said "it's truncated" out loud and had nowhere to go. Hand back `next_offset`, and a `find` that centres the window on a phrase. — 09-26
- **"No text" must say WHY, or it reads as a transient miss.** `has_full_text: false` with no reason had the agent re-fetching the same empty document twice in one turn. The distinction it needs is permanent-vs-transient: a scan or an unsupported type will never answer, so name the file as a gap and work the other sources. — 09-26
- **A NULL `ai_summary` IS A DOCUMENT THE AGENT NEVER OPENS.** `list_documents` and `get_record_brief` present a document *by* its summary, so a text-only backfill leaves files that read as empty: Ber AI said *"the lease is a scanned PDF the platform cannot read"* while `get_document_content` returned its 665 acres on request. A text pass is not finished until the summaries follow. — 09-26
- **A KEYWORD SEARCH THAT ONLY MATCHES THE WHOLE PHRASE ANSWERS "NOTHING" WHERE IT MEANS "NOT ADJACENT".** `ilike '%title commitment%'` returned zero against five threads about title commitments, and zero reads as "there is no such correspondence" — the one wrong answer. Fall back to any-word, and **rank the fallback by how many words matched**, or a wide net answers "Hill AFB site visit" with notes that merely said "site". — 09-27
- **MAIL GATEWAY NOISE RANKS.** Proofpoint/ATP/Inky leave 300-400 character link wrappers in every message; chunked and embedded they compete with prose, and a hex dump was the TOP passage for a question about a title commitment. Scrub at index time AND at read time — the read-time pass reaches the thousands of chunks already indexed without a re-embed. `src/lib/ai/text-noise.ts`. — 09-27
- **SCRUB THE PASSAGE, DO NOT WITHHOLD IT.** Dropping the passage costs the answer; dropping the run costs nothing. Withhold only what is left with nothing in it, and never the last one — an empty result reads as "there is no correspondence on this". — 09-27
- **A NOISE FILTER MUST BE MEASURED AGAINST THE CORPUS, AND EVERY CLEVER VERSION COSTS EVIDENCE.** Share-of-prose below 35% withheld 11.6% of the index including three bid invitations; share-of-short-tokens was worse at 14.4%, because a BuildingConnected invite is mostly long links and links are content. Density of ordinary words below one per forty characters withheld 2.2% with zero false positives — **and had to count figures as words**, or it withheld the insurance ledgers. — 09-27 Same lesson on an extraction's quote rule: a length floor of 8 let `"see above"` through, and a five-word floor then discarded all four figures a real pass produced (`"20MW System"`, `"PUE guarantee (1.18)"`) — every one correct. **What a quote must do is CONTAIN THE FIGURE**, which is checkable rather than guessable. — 10-05
- **A PROMPT EXAMPLE IS TRAINING DATA, AND A STALE ONE IS A LIE THE MODEL REPEATS WITH CONFIDENCE.** A rule illustrated with *"the acreage is in Full Claim List.xlsx, which the platform cannot read yet"* had the agent saying exactly that about a file indexed an hour earlier. Never illustrate a rule with a limitation you are in the middle of removing. — 09-26
- **A TAXONOMY WRITTEN INTO A PROMPT IS A SECOND SCHEMA, AND IT DRIFTS SILENTLY BECAUSE A CATEGORY THE MODEL WAS NEVER TOLD ABOUT SIMPLY NEVER FIRES.** Generate the enumeration from the same rows the column references, and fingerprint that set in the prompt version. Keep it out of TOOL DECLARATIONS especially: those are a static array re-sent every request, so a stale `enum` names a lane that must not be used and hides one that should. Match leniently on key or label, and say when you matched neither. — 09-30
- **NEVER MAKE THE MODEL COUNT ROWS — PRINT THE COUNT.** Handed a 69-row claim schedule, the local model answered 62 and split them across townships wrongly too. The count is the figure an executive repeats out loud, it is arithmetic rather than judgement, and a line of code is exact at it. Extractors state row counts; the model groups and interprets. — 09-26
- **A URL THE MODEL NAMES IS A GUESS UNTIL IT IS FETCHED.** Grounded search returned one real bio page, one 404 and a LinkedIn URL answering 999 — two path patterns from one CMS, so at least one was invented. Require the PAGE to carry the evidence (the person's own name). The danger is never the 404; it is a valid page about a different person of the same name. — 09-27
- **`GEMINI_API_KEY` IS ON THE FREE TIER: 20 `gemini-2.5-flash` REQUESTS PER DAY.** Every web-research feature shares it, and Enrich Profile spends three per contact — about five contacts a day. It presents FIRST as `503 high demand` and only later as `429 …FreeTier`. Never retry a daily quota, cap the SDK's own wait (it has none), and stop a batch at the wall rather than recording its remaining rows as genuine misses. — 09-27
- **A FALLBACK IS A CONCLUSION, AND IT CAN ONLY BE DRAWN FROM A CHECK THAT RAN.** Falling back to a company logo when the headshot search had 429'd — rather than searched and found nothing — would have capped the directory at logos on the strength of one bad afternoon, and excluded everyone from every future pass. Distinguish "looked and found nothing" from "never looked". — 09-27
- **A MONEY FIGURE MUST CARRY ITS SHAPE, AND A COMPARISON BETWEEN TWO SHAPES IS NOT A COMPARISON.** An annual total measured against a contract value over a term reports the whole deal as unattributed; a fifteen-year contract total over a one-time build figure returned a capture share of 172%. Annual, contract, one-time, asset and capture are five quantities, never interchangeable and never summed. Store the shape beside the amount and CHECK that both are set or neither. — 10-05
- **A SUM WITH NOTHING IN IT IS NULL, NOT 0, OR THE SCREEN PRINTS A FACT ABOUT THE DEAL.** A rollup that totalled 0 because no line had a term yet showed "$0 contract value" beside a real $120.9M annual figure, which reads as computed rather than unfinished. Make every rolled-up figure nullable and let `tsc` name the call sites; a caller renders null by omitting the row or naming the absence in words. — 10-05
- **A DERIVED FIGURE THAT IS A SHARE OF ANOTHER MUST NOT BE SUMMED WITH IT, AND WHETHER IT IS A SHARE IS A FIELD.** An $18M margin on a $150M build is inside the $150M, so the gross is $150M and never $168M — but a commission the owner pays on top of a package IS incremental. One is true of margins and the other of commissions, so the screen asks rather than the code assuming. The same reasoning makes a percentage's BASE a field: 1.5% of a capital figure and 1.5% of annual revenue differ by two orders of magnitude. — 10-05
- **`fit_score` carries ±20 points of sampling noise.** Read the pursue/consider/pass verdict, never the number; do not sort or threshold on it. — 08-26

**Matching & extraction**

- **Ambiguity must mean NO match.** Two records scoring identically on a name is the case that must refuse, not guess. — 09-09
- **One match is not a unique match — it is an unchallenged one.** A lone hit on a weak key (a bare first name) resolved "Cliff" to an unrelated academic on a live deal. Require a strong key, or refuse and say what was found. — 09-24
- **A fuzzy threshold is measured against the real corpus, never chosen.** And a score too low to act on is still worth SUGGESTING — "closest in the mail" costs the reader a glance; an auto-resolve at the same confidence files the wrong person. So AN AUTOMATIC BAR AND A PRE-TICK BAR ARE TWO BARS AND NEVER ONE NUMBER: filing a transcript on the wrong deal has it answering questions about that deal until somebody notices, while a wrong pre-tick costs one unticked box. — 09-24, 10-08
- **SOMETIMES THE MEASUREMENT SAYS A THRESHOLD CANNOT WORK, AND THEN THE QUESTION IS WHICH WORD MATCHED.** "Eagle Mountain Development" arrived PRE-TICKED as Myton Development at 0.487 while the correct "Delta, Utah Campus" → "Delta Industrial Campus" scored 0.390 — the wrong match ranks higher, because four live projects share the word *Development*. Require a shared identity-bearing word, and keep PLACE names out of the generic list — Myton, Delta, Heber and Tooele are what distinguishes these records. — 09-28
- **A mailbox is a better key than a name.** `commitments.owner_name` holds four spellings of one man, the company under two, a bare `Hola`, and 31 nulls — while every row carries the mailbox of its thread. And check what the field MEANS on each side: for `side='them'` the owner is the counterparty, so resolving it to a teammate says someone owes themselves. — 09-24
- **Never print a reader's own name back at them.** "Review and sign the MNDA — extraction named: Richard White", rendered into Richard's own note, came back as "Richard White is waiting" — a third party invented out of the recipient. When the owner IS the reader, "this one is yours" is the information. — 09-24
- **A thread with more than ~15 participants is a distribution list, not a conversation.** Its recipients are not a deal cast. Measured — 2,391 of 2,436 threads have five or fewer. — 09-24
- **A dedupe key derived from a conversation's FIRST message identifies the conversation, not its contents.** Never use one to decide "already seen". — 09-09
- **A NEW RECORD TYPE IS A DESTINATION FOR THE HUMAN, NEVER A CLASSIFICATION FOR THE MODEL.** Adding a `'lead'` kind to the meeting extraction is wrong: the model has no sight of the database, a call about a live project reads exactly like a call about a site nobody has heard of, and the mis-classification would skip record matching altogether. Ask the model what a thing IS; let the human pick where it goes. — 09-29
- **A SHARED INDUSTRY WORD IS THE ONE THING A COMPANY IDENTIFIER MUST NOT BE.** Matching an organisation to a domain on any keyword substring put `bfaenergy.com`'s logo on Bloom Energy. A domain must START with the organisation's leading distinguishing word, and industry words (`energy`, `mining`, `capital`, `steel`…) belong in the stopword list beside `LLC`. ⚠ THE SAME LIST GOVERNS RECORD NAMES, NOT JUST DOMAINS: a meeting titled "Steelton & Riverdale … Power Capacity Analysis" was suggested as "Stockton **Power** Nexus" — different states, one shared industry word. Keep PLACE names out of it; Myton, Delta, Heber, Steelton and Stockton are what distinguish these records. — 09-27, 10-08
- **A FILE TYPE WITH NO BRANCH IS INVISIBLE, NOT UNREADABLE — AND NOTHING REPORTS IT.** `documentKind` had no pptx case, so two investor decks were classified "unsupported", skipped, and got **no `documents` row at all** — the deck stating the $88M raise was absent from the knowledge base for weeks. An unsupported type at least leaves a row to find. Before adding a source, check the extension list covers what the folder holds. — 09-27
- **AN UNLABELLED COUNT IS NOT A COVERAGE SIGNAL.** `drive-sync` incremented one `skipped` counter from six branches, so the nightly log read `skipped: 26` whether nothing was wrong or a deck was dropped. Count the REASON beside the number. — 09-27
- **A coverage count is the only honest signal for a feature whose failure mode is doing nothing** — and a count that has stopped growing is indistinguishable from a quiet inbox. Measure AGE instead. **A LIVENESS CHECK NEEDS A CLOCK, NOT A COUNT:** excusing two `processing` rows as "a pass running now" hid a document stranded mid-pass for 13 days, every night, and the comment above the rule already named it. With no `updated_at`, a creation time is a FLOOR on age — which errs toward calling a corpse young, never a worker old. — 09-09, 09-20, 10-05
- **READ `documents` WITH `superseded_at is null` OR THE GRAVEYARD READS AS A GAP.** Ten documents held real text and no chunks, including an 88k-character proposal, and looked like a silent indexing failure worth a backfill script. All ten were deliberately retired duplicates whose live twins are indexed. — 09-27
- **A FLAG NAMED LIKE A YES/NO IS NOT NECESSARILY A YES/NO, AND THE WRONG GUESS BUILDS AN EMPTY LAYER THAT NOTHING REPORTS.** NARN's `STRACNET` holds `S` and `C`, never `Y`: a `='Y'` filter typechecks, builds, ships, and produces a layer with zero features and a toggle that does nothing. **A geodatabase names its own codes — ask it** (`ogrinfo -fielddomain`). — 09-30
- **A DATASET'S NULL MARKERS LOOK LIKE VALUES, AND SO DO ITS PLACEHOLDER CODES.** NARN writes the literal `#N\A` into `BRANCH` 42,448 times and uses `XXXX`/`PVTX` where a railroad has no reporting mark — each rendering at a reader as if it were a name. Scrub at the import, and find them by printing three real rows out of the transform rather than trusting that `null` means null. — 09-30
- **BUILD A CODE→NAME DICTIONARY BY QUERYING THE CORPUS, NEVER FROM MEMORY.** Written from recall, the rail owner lookup had seven marks **not one of which appears in this data** (the Class I marks here being UP/BNSF/CN/CPKC/CSXT/NS after the mergers). A stale dictionary is not a partial one: it falls through to the raw code for every row while looking authoritative in the source. One `group by … order by sum(miles) desc` replaced the whole guess. — 09-30
- **AN EXHIBIT IS OFTEN DATA WEARING A PICTURE, AND THE SHEET USUALLY NAMES ITS OWN SOURCE.** The Delta rezone exhibit's disclaimer named "Millard County / Utah AGRC parcel geometry" — so its 11 parcel footprints were fetchable by the ids the sheet prints, rather than traced or OCR'd. Read a plan's title block and disclaimer for a schedule and a provenance; what is left over after the data is extracted is the only part genuinely a picture. — 09-28
- **TWO SOURCES FOR ONE FIGURE GET TWO COLUMNS, NOT A WINNER.** The application said HD-5534-A-1 was 13.00 acres and the assessor said 4.69. Picking either loses the fact that anyone disagreed, which on a rezone is the fact worth keeping — and an importer that COMPARES surfaces it on the first run, where one that chooses never would. — 09-28
- **FILLING A BLANK AND OVERWRITING A VALUE ARE DIFFERENT ACTS, AND ONLY ONE OF THEM IS SAFE TO AUTOMATE.** Attaching a staged package to an EXISTING record exists because a human already curated it, so the pass fills only NULL/whitespace columns, never renames, and reports which moved. The exclusions are the interesting part: a NOT NULL column is never blank, so "filling" it could only mean overwriting; `stage`/`status` are a judgement no email reports. — 09-30

**Shape of a pass**

- **A DESTINATION THAT DOES NOT CARRY WHAT CREATING CARRIES READS AS LOSING THE WORK.** `merge` handed an existing record id to `linkClusterToRecord` and nothing else: the report, the people, the tasks and the staged attachments were discarded silently, so "Merge → X" quietly cost more than it saved. If two paths differ only in WHERE the work lands, they must be one pass with a target parameter — never one full pass and one shortcut. — 09-30
- **Never fork a shared pass per table — add a target.** The one forked copy of `runDocumentAiPass` silently discarded 413,000 characters. ⚠ **AND THE MIRROR IMAGE IS ONE TABLE SHARED BY SEVERAL KINDS: A PASS THAT DOES NOT FILTER THE KIND COLUMN ACTS ON SHAPES IT WAS NEVER WRITTEN FOR.** `email_intake_sessions` holds five; `predecide` auto-dismissed two recorded meetings and the intake deduper would have rewritten one into an email proposal — both selected `status='pending'` and nothing else. Filter it; the column is NOT NULL with a default, so the `.eq()` cannot silently skip a real row. — 09-17, 10-08
- **AN AUTOMATIC PRODUCER MUST WRITE THE SAME TABLE THE MANUAL ONE DOES, OR EVERY READER SEES ONLY THE HAND-TYPED HALF.** The Meet importer staged sessions and filed documents and never once wrote to `meetings` — 2 hand-typed rows against 5 imports — so `search_meetings`, the record's own Meetings tab and the governance register all answered nothing about a call from the day before. A table nothing automatic writes to stops being the register of anything. Ask which table the READERS select from, and check whether the new path reaches it. — 10-08
- **Split the instant local step from the slow remote one, and run the local step first.** Recognition is a second; research is two minutes. Doing all the recognition up front tells the reader which photo to retake while the card is still in their hand, and means only text is in play by the time anything slow starts. — 09-24
- **A record created with no owner is invisible under a default "mine" scope.** A lead promoted to steel landed with `salesperson_id` NULL against a board that filters on exactly that column — created, correct, and in nobody's pipeline. Default the owner to whoever acted, and count unowned records over the WHOLE set, outside the scope. — 09-24
- **A promotion that creates a record must carry everything the record's next button needs.** The steel deal's Quote button is gated by `quoteReadiness()`, and two of its blockers were sitting on the lead unread. Reporting success and then handing over a disabled button is the same failure one screen later. — 09-24
- **A UNIQUE INDEX ON A FOREIGN KEY MEANS ONE CHILD, AND SILENTLY KEEPING THE FIRST IS WORSE THAN KEEPING NONE.** `tasks.lead_id` is unique, so a call raising three follow-ups about one lead can have at most one as a task. They are kept as note TEXT and the UI says so in place. When a constraint means a set cannot be stored, store none of it and name what you did. — 09-29
- **A PROVENANCE LINE THAT INVENTS A PROVENANCE IS WORSE THAN NO LINE.** `originNote` was written two-way (email vs web form) and told a lead staged from a MEETING it came "from an email enquiry" — and that sentence is written onto the record as its description, where it outlives the lead. Every arm of a provenance string must be true for every source, and adding a source means checking all of them. — 09-29
- **AN ORPHANED PROJECTION LOOKS PERFECTLY LIVE, AND RENAMING OR SPLITTING ITS SOURCE IS WHAT ORPHANS IT.** Splitting the Dino lane left "Dino Leads" in Drive — full, shared, bookmarked, frozen. Retitle it *"(no longer updated)"* rather than trashing it. **Build the "still live" set from what SHOULD publish, not from what succeeded this run** — otherwise one transient Drive error retires a live lane. — 09-30
- **DOMAIN SHARING REACHES NOBODY OUTSIDE THE DOMAIN, WHICH IS PRECISELY THE AUDIENCE A PROJECTION EXISTS FOR.** The lead sheets are published for people with no platform login and were shared `type: 'domain'` with berwilson.com, so the list published FOR them was one they could not open. Grant named addresses explicitly, assert it every run (a grant removed by hand in Drive is invisible from here), and notify on first grant only. — 09-30
- **A VERIFICATION SCRIPT WHOSE `finally` CALLS `process.exit` SWALLOWS THE THROW IT IS UNWINDING,** so a crash halfway down it is indistinguishable from the checks below it quietly not running — 17 green ticks and no reason given. Catch, name what threw, THEN clean up. And when a check fails, suspect the check: `activity_log.action` is `TG_OP` (so `'UPDATE'`, never `'updated'`) and its diff is in `field_changes`, not `metadata` — reading either wrong reports a trigger as dead while it is firing perfectly. — 10-06
- **Measure before building.** Repeatedly the premise was wrong: the Drive was already clean, the local model is 93% idle because it has FINISHED, and three planned passes were built and then REMOVED after measuring them. — 09-22, 09-23

**UI**

- **A SHARED RENDERER WIRED TO ONE SURFACE IS WORSE THAN NO SHARED RENDERER.** `BriefMarkdown` was written so the printed brief would be the document read on screen — and only the print route used it. The screen showed literal `##` under a `prose [&_h1]:…` wrapper whose every selector was dead, because the string it styled produced no elements. Grep for a renderer before building one, and for every surface that should call it after. — 09-26
- **A CACHE IN `localStorage` FOR CONTENT THAT LIVES IN THE DATABASE IS NOT A CACHE, IT IS THE ONLY COPY THE PAGE CAN SEE.** The project brief was invisible to any browser that had not generated it — a second executive, a new laptop, a cleared cache — and a failed regeneration blanked the panel while a good brief sat in `stored_briefs`. Read the stored copy server-side and let the refresh only improve on it. — 09-26
- **CHECK WHETHER THE DATA IS ALREADY ON THE ROW BEFORE CALLING A LIST "AN EXTRACTION PROBLEM".** `/decide` buried value, location, sector and deadline in a truncated paragraph while `leads` carried all four as columns and the page already did `select('*')`. It looked like schema work and was a UI change. — 09-26
- **FIXING A GENERATOR CHANGES NOTHING THE READER SEES.** `Bid due — ` and `Ber AI: PURSUE (82/100).` were written into `tasks.title`/`tasks.why` at insert time, and those columns are what Pepper emails and what Google Tasks shows on a phone. Back the existing rows up, then rewrite them. — 09-26
- **A PARENT RECORD'S VALUE IS THE SUM OF ITS LEAVES AND NEVER ITS OWN FIGURE AS WELL.** `parent_project_id` was used by 0 of 14 projects, so the arithmetic had never run — and it was wrong in three places at once, each totalling `[parent, ...children]`. Economics lives on leaves; a container's value is what the work inside adds up to, and the overruled figure is reported rather than dropped. **Judge parenthood by what is PRESENT in the same set**, because an access-scoped or filtered list holds children whose parents are gone, and the column alone would erase a deal from its own total. — 10-08
- **ONE QUANTITY, ONE DEFINITION, OR THE READER TRUSTS NONE OF THEM.** Three "needs attention" numbers on one screen — 1, 99+ and 197 — because the layout, the KPI tile and the rail each summed their own list. Two different quantities must be named apart and never summed; a badge cap that turns 197 into `99+` invents a third. ⚠ **AND A LABEL WRITTEN INLINE ON FOUR SCREENS IS A LABEL WITH NO OWNER:** all four spelled `target_kind === 'company' ? … : project?.name ?? 'Project'`, so every SPV commitment rendered as the bare word *Project* — `project_id` is NULL on that arm, making the fallback the branch that always fires. One exported function, and `tsc` names the call sites. — 09-26, 10-08
- **A BARE EM DASH AT A VALUE'S OWN WEIGHT READS AS A FAILED RENDER.** Omit the row, or name the absence in words ("No value set"). And a KPI tile with no value is not a KPI tile. — 09-26
- **WHEN EVERY ROW IS RED, RED HAS STOPPED SIGNIFYING.** Nine consecutive commitments at 227d, 218d, 117d… all in alarm colour. Band it and reserve the colour for what is still actionable. — 09-26
- **A CONTROL THAT ONLY APPEARS ON HOVER DOES NOT EXIST ON A PHONE**, and one without `focus-visible:opacity-100` can be focused by a keyboard user who cannot see it. Gate the hiding on `sm:`. Two of the fifteen were deletes. — 09-26
- **`focus:ring` FIRES ON A MOUSE CLICK TOO.** 248 sites used it, so clicking into any field flashed a ring. `focus-visible:` is the one that means "reached by keyboard". — 09-26
- **A COLUMN WITH A `<select>` IS NOT AS WIDE AS YOU WROTE IT** — a native select sizes to its widest option, so one long project name stretched a filter to half the row and wrapped the other three. Bound it. — 09-26
- **THE LONGEST FORM IS NOT THE WORST FORM.** `ProjectForm` and `SteelDealForm` are the best-structured in the repo; the a11y debt was in six short ones. And `control-has-associated-label` is the noisy jsx-a11y rule (334 hits, 6:1 false positives), while `label-has-associated-control` found the real 101 in 22 files. — 09-26
- **DO NOT WIZARDIZE A SERVER-ACTION FORM.** `<form action>` + `useActionState` submits one `FormData` from one form; steps mean hiding fields with CSS (and the browser's "required field is hidden" failure) or lifting every field into client state. `ProposalIntakeWizard` is not the precedent — its steps exist because step 2 cannot run until step 1 returns. Collapsible sections get the same benefit with every field mounted. — 09-26
- **A TAILWIND CLASS STRING STORED IN THE DATABASE IS NEVER GENERATED.** Tailwind v4 emits only what it finds by scanning source, so a `badge` column holding classes produces an unstyled element with no error anywhere — not a build failure, not a console warning. Store a tone NAME against a fixed palette declared literally in source, offer it as a dropdown, and REJECT an unknown tone instead of defaulting it. — 09-30
- **DEFINING A HELPER IN THE COMPONENT BODY CAN DESTABILISE A FUNCTION IT CALLS**, and the React Compiler's exhaustive-deps rule then reports it against effects you did not touch. The warning is a design signal, not noise to suppress: a layer builder needing only its arguments belongs at module scope. — 09-28
- **A SECOND RENDERING OF THE SAME REAL-WORLD THING IS NOT AN ADDITION, IT IS A DOUBLED LINE.** The Protomaps basemap already draws OSM rail as `roads_rail`; the NARN layer over it is the same track from a different survey, a few metres off. Hide the basemap's while ours draws and restore it when ours is off. Before adding an authoritative layer, grep the basemap's layer list for what it already covers. — 09-30
- **WHAT A TILE LAYER DROPS AT LOW ZOOM MUST BE DECIDED BY WHAT A FEATURE IS, NOT BY DENSITY.** `--drop-densest-as-needed` is blind to kind, so it thins a strategic corridor through a busy terminal district while keeping the yard tracks beside it. Set a per-feature `tippecanoe.minzoom` from the attributes (STRACNET z2, main line z4, yard track z9). **Then check the toggle at every zoom** — the first build made "All rail" do nothing below z6. — 09-30
- **A NAV ITEM'S `alsoMatches` MAY ONLY NAME PATHS WITH NO NAV ITEM OF THEIR OWN.** `navItemActive` is per-item with no dedupe, so `/decide` claiming `/leads` lit two sidebar items at once — and the reader believes the one that is highlighted, so a destination that was there all along read as a sub-view of the queue. **And a filter kept only in component state is not a view:** it cannot be linked, bookmarked or sent to anyone, which reads as the thing having no page. Put it in the URL with `history.replaceState` to keep it off the server. — 10-03
- **New UI uses the Panel / Chip / `label-caps` idiom and `.elev-*`, never raw `shadow-*`.** No glassmorphism, no animated numbers, color only for status meaning. Date fields use `DatePicker`, never a native `<input type="date">`. — 07-17, 07-10
- **Task owners and contacts are one person** — `team_members.party_id` ties them; adding or using an owner maintains the contact. — 07-21

**Working in this repo**

- **Two Claude sessions share this repo.** Stage files BY NAME, never `git add -A`, or you absorb the other session's in-flight work. Four recorded occurrences. **⚠ AND BY NAME IS NOT ENOUGH WHEN ONE FILE HOLDS BOTH SESSIONS' EDITS.** `src/types/database.ts` is hand-maintained (§4), so both sessions had added columns to it — `git add` of that one path would have committed half of the other's confidential-projects feature. Stage it through a FILTERED PATCH instead: `git diff <file>` → drop the hunks that are not yours → `git apply --cached`, asserting the expected number of hunks dropped, then grep the staged diff for the other feature's keywords before committing. **Also check the migration numbers**: both sessions independently took `20260930000004`. — 09-23, 09-30
---

## 13. BUILD STATUS

**Reality:** well beyond the original Phase 1/2 plan. Live and in daily use, **self-hosted on the Mac Studio** (`100.102.45.39`, tailnet-only) against self-hosted Supabase under Colima, with AI served by LM Studio on the same machine. Vercel is no longer the runtime.

**Working — the surfaces that exist.** Dates mark when each landed; the story behind any of them is in the log.

| Surface | What it does |
|---|---|
| **projects** | CRUD, pipeline/program views, hierarchy, all detail tabs — plus a **Land tab** (county parcel schedule, deal-vs-assessor acreage, boundaries imported by parcel id from Utah AGRC, 09-28) |
| **vehicles** | a tab on every project and opportunity (10-06): the SPVs a development site is held in — Land, Energy, Data Center and any others — each with its own participant ledger carrying equity splits, capital committed and capital funded, an optional link to the SPV's node in the corporate org chart, the engine's gross and net for that vehicle, its own paperwork (filed against its LEGAL ENTITY via `documents.entity_id`, so an operating agreement outlives the deal being renamed or split), and the raise pipeline shown beside the cap table rather than added to it. Ber Wilson's share is read from the ledger rather than typed, and an incomplete split is reported as undetermined rather than guessed |
| **/vehicles** | every SPV across every deal, read-only (10-08): the cap tables that do not add up first, then each deal's vehicles with holders, committed and funded capital, our derived share, and the raise pipeline named apart from the ledger. A vehicle is still edited only on the deal that owns it |
| **economics** | a tab on every project and opportunity (10-05): the capacity ledger, 13 revenue line types, SPVs, per-field provenance, saved versions, and deal size in six quantities across three tiers — revenue generated, Ber Wilson gross, Ber Wilson net of SPV ownership. Ber AI reads the deal's documents and PROPOSES figures with the sentence each came from; accepting records the figure and its source together |
| **/calc** | the scratchpad (10-05): megawatts and one price, computing in the browser with the same engine, state in the URL so a figure quoted on a call is a link. ⌘/ opens it anywhere |
| **/map** | offline basemap, illustrated markers, parcel polygons, present mode, and the national rail network underneath — STRACNET + defense connectors or the whole NARN, click a line for owner/subdivision/trackage rights (09-30) |
| **opportunities** | the same child records as projects (09-23) |
| **tasks** | per-person workload, project/opportunity/objective tags, handoffs (waiting-on), printable weekly report at `/reports/weekly/print` |
| **objectives** | Now/Soon/Possibly steering board + PDF export, wired into tasks/dashboard/brief |
| **investors** | capital raise pipeline — relationship stages, per-deal commitments vs parent co / project SPVs, named raises w/ tranche schedules, per-raise dashboards, Ber AI tools + RAG |
| **/steel** | prefab steel deal pipeline with its own `steel_sales` role (07-25); one-click quote from a Drive-hosted Doc template → PDF on the deal + in Drive (09-16) |
| **/dino** | internal operating-company revenue tracker — internal-vs-external split + $150k payment schedule, admin-only (07-28) |
| **Pepper** | the assistant layer (09-24) — a per-person morning note by email at 06:50 weekdays (what you owe / are owed / your day / the queue, **plus your own tasks itemised**) as *Pepper <info@berwilson.com>*, plus batch approval on `/decide`. **The Monday task digest was retired into this 2026-10-08** — it read the same query and sent the same two buckets ten minutes later; its list now goes out five mornings a week instead of one |
| **Directory** | one destination (Contacts \| Vendors tabs) + business-card scanner — photo → on-device OCR → researched contact, a whole stack at once via `/intake?tab=cards` |
| **governance** | three admin-only registers under `/company` (09-30): **Personnel** (employment records, agreements, a 25-step offboarding checklist — recording a departure closes signature authority, revokes the login while snapshotting what it reached, and marks the chart departed rather than deleting it), **Corporate record** (resolutions, appointments & signing authority, ownership), **Compliance** (entity filing calendar, conflict disclosures, related-party register, policies) — plus an audit trail on the twenty tables behind them |
| **/intake** | one destination: Email \| People \| Cards \| Meeting \| Proposal \| Document. Email Intake sweeps Gmail → report → opportunity/project + people + tasks; **People Intake** (09-24) takes a cast of names and reads their profiles out of the stored mail; proposal intake runs assessment → project creation. A **meeting can stage candidate deals as LEADS** rather than records (09-29) — the right shape for a brokerage call naming a dozen properties; each is fit-scored overnight, promoted by hand, and a lead already on file can be ATTACHED rather than duplicated |
| **meetings** | a Meet recording becomes a record on its own (10-08): the transcript is filed and indexed the night it happens — on the deal when the title is a strong key, on the reference shelf otherwise — and a row lands in `meetings`, so Ber AI can quote what somebody actually said, with the timestamp. Confirming the session moves the transcript onto the deal and teaches the platform that title, so the next call in the series files itself |
| **intel** | RAG + streaming agent, plus the ambient **Ask Ber AI** dock (⌘J, every page) |
| also | dashboard (single attention surface, opens with Now objectives), timeline, company profile (thin), review queue, activity log, manual-paste extraction (action items → real tasks) |

Calendar/meeting-prep and mail both run on Google Workspace via per-mailbox OAuth (Microsoft Graph removed 08-23); the email-to-task scraper was removed (§11). Equity & Portfolio modules removed 07-03 (§9).

**Full history: [`docs/BUILD-LOG.md`](docs/BUILD-LOG.md)** — every dated entry, carrying the reasoning, the measurements and the verification behind every decision. Not auto-loaded; grep it when you need the "why" (*"why is the digest at 7:00am?"*, *"have we hit this bug before?"*). **Open items: [`docs/OPEN-ITEMS.md`](docs/OPEN-ITEMS.md)**, also not auto-loaded.

### Open items (Richard)

**The full table — 48 rows, including everything marked *as reported* / *cosmetic* / *standing* / *self-resolving* — lives in [`docs/OPEN-ITEMS.md`](docs/OPEN-ITEMS.md)** (split out 2026-10-01 to get this file back under its own 100k threshold). It is not auto-loaded; read it when picking up work. Below are only the rows that want something from Richard. Each is **as last reported on its date, not re-verified** — confirm against the live system before acting.

**Do this first (5 minutes):** enrol an authenticator at `/settings/security` **before protecting any project** — otherwise the only way back into a protected project is `delete from step_up_sessions` in psql. Eric needs his own; a factor is per-person by design. — 09-30

**Needs an action from you**

| Item | Where | Raised |
|---|---|---|
| **`git push` 403s — the GitHub backup was 11 commits stale (10-01 → 10-05) and nothing said so.** gh's active account is `richmwhite1`, which cannot write to `berwilsonai/berwilson-platform`; no global or repo-scoped setting serves both that and your four personal repos. **Add `richmwhite1` as a collaborator with write access** — then the runbook's `git push` just works | github.com → repo Settings → Collaborators | 10-05 |
| **`estimated_value` is cleared, so the pipeline reads $0 until the first economics model is built.** Intended, not a fault. Stockton is the best first model: the platform already holds its $152.5M proposal | `/projects/…/economics` | 10-05 |
| **Delta's three vehicles exist and their splits do not.** Delta Land / Energy / Data Center LLC each carry Ber Wilson flagged as sponsor with `equity_pct` deliberately NULL, so our share reads **undetermined** and the engine holds Delta's revenue out of the net total rather than counting it as ours. Type a percentage on the Ber Wilson row of any vehicle and that vehicle's net figures fill in. Myton and Stockton still have no vehicles at all | `/projects/…/vehicles`, `/vehicles` | 10-08 |
| The eight seeded benchmarks are all flagged for review and are plausible public ranges, not checked figures. Fix the three that will touch real deals (DC lease rate, powered land per MW, Utah industrial rate) and clear the flag | `/settings/economics` | 10-05 |
| Flooring has a Drive folder and a sheet but no handoff address, so its button stays disabled — nothing in the mail names a flooring contractor. Both Dino lanes are live (`dinoservicepros@gmail.com`) | `/settings/lead-categories` | 10-03 |
| Sign in as `moose@berwilson.com`, not `info@` — info@ is the Pepper seat and greets you as her | — | 09-24 |
| **Fold the duplicate proposals BEFORE working the queue.** 114 email proposals are staged and several describe one deal — **ten name Steelton, six Myton, five Zenthium**; confirming them as they stand creates ten Steelton projects. The deduper now has a door (10-08): "Show me what would fold" plans and changes nothing, a second press applies. Live dry run: **would fold 30 into 6, leaving 84 to review** | `/intake` | 10-08 |
| Then clear them — "Select the N Ber AI is sure about" accepts the high-confidence block in one sitting | `/decide` | 09-24 |
| One People Intake session staged and un-confirmed (Seth Lloyd, Trevor Burton) | `/intake?tab=people` | 09-24 |
| **FIVE recorded meetings are staged and un-confirmed, and every one is searchable but on no deal.** All five transcripts are now filed and indexed, so Ber AI can already quote them — what confirming adds is the deal, the people, the follow-up TASKS (8 from the Tensor call alone), and the title learned so the next call files itself. Yesterday's Tensor call leads the queue | `/decide`, `/intake?tab=meeting` | 10-08 |
| **The call titled `Ber Wilson / Zenthium` (09-29) is almost certainly the `Zenthium Partnership` opportunity** — the platform suggests it but will not file it, because the title is not the record's name. One confirm attaches it AND teaches the title. ⚠ Note the model retitled that call "Steelton & Riverdale Site Reviews & Power Capacity Analysis", so it does not look like a Zenthium call in any list that shows the model's title | `/intake?tab=meeting` | 10-08 |
| 17 site photos and logo SVGs are pre-ticked as "not a document" — one batch accept clears them | `/decide` | 09-30 |
| The `Corporate /M & A/` shelf is a per-deal subtree answering as company knowledge — 52% of company chunks; 21 have a one-click home, the rest need a look | `/decide`, `/company` | 09-30 |
| The governance registers are built and empty — filing calendar, signing authority, 2026 conflict disclosures, Dino as a related-party transaction. An hour each | `/company` | 09-30 |
| Nobody is in the personnel register, including you and Eric — it is what makes a future departure one click | `/company/people` | 09-30 |
| The Heber project has no coordinates and is not on the map; its site plan has no legend or survey basis | `/map` Place Projects | 09-28 |
| Both site plans were photographed, not exported — ask JLD for the source PDFs (Delta's is *Sheet 1 of 2*; sheet 2 is not on file) | — | 09-28 |

**Needs a decision**

| Item | The call | Raised |
|---|---|---|
| 80 of 83 contacts have no photo; the blocker is the Gemini free tier at 20 requests/day | Enable billing on `GEMINI_API_KEY` (cents for the whole directory, also unblocks Enrich Profile), or re-run the backfill on successive days | 09-27 |
| `SNL_Letter_Englert_Results.pdf` is password-protected and can never be read | Needs its password | 09-26 |
| Three IBC Building Code PDFs exceed the 30MB knowledge-base ceiling — the only real content still absent | Raise `MAX_FILE_BYTES` on a 36GB box that already swaps, or accept that a code manual is reference the agent rarely needs verbatim | 09-27 |
| Delta's rezone application states HD-5534-A-1 at 13.00 acres; Millard County records 4.69 (exhibit total 928.98 vs cadastral 920.67) | Resolve with the recorder before the figure goes into an application or a price | 09-28 |
| Confirm the Elite Solutions / Avant commission base: 1.5% a year of the internals CAPITAL value (built that way, about $26.25M a year to us on 200MW) or of its annual revenue | The two differ by two orders of magnitude; the engine supports either and the screen asks | 10-05 |
| What must be minuted, and how long personnel records must be kept | One call with corporate counsel: retention per record type, resolution vs officer's signature, whether Series/Standalone changes it | 09-30 |
| An SPV's documents hang off its LEGAL ENTITY, so a **protected project does not contain them** — they stay readable on the entity's page and to portfolio search. True of every entity document, and the Vehicles tab says so in place | Accept it (file anything that must stay contained on the project's Documents tab), or ask for the confidential scrub to follow entities to their vehicles | 10-08 |

**Next build work, specified:** 903 email attachments have never been imported (stage the reference, fetch on a human filing decision — `promoteStagedAttachment` is already the right dispatch); `/contacts` is the densest remaining scanning problem (80 records six to a screen — a ~72px row plus a list toggle, designed not built). — 09-30, 09-26

`GOOGLE_CHAT_WEBHOOK_URL` is now **set**, so the 09-23 manual step is done — but if you created a dedicated "Ber Wilson Updates" space, confirm it points there rather than at the old room.

### Highest-leverage next work

1. **Give Pepper ears** — email `info@` a question from a phone and have her answer in-thread over the agent's 42 read-only tools, sender-allowlisted to the two executive addresses. `info@` is already swept nightly and is the one mailbox that can send; the parts are almost all built. This is the single most assistant-like thing left.
2. ~~**Drain the overnight backlog**~~ — **DONE / was never the backlog it looked like (verified 2026-10-05).** The sweep's `remaining: 0` is truthful: both counters use the identical filter as their candidate query. All **1,287 `deal`/`summarized` threads have had the commitments pass**; the 1,529 without it are `pipeline='lead'`, deliberately out of scope. Embed likewise — the 879 deal threads with `embedded_at` null are *exactly* the 879 classified `noise`, and the 1,058 lead threads marked embedded with no chunks are spam-filtered leads stamped on purpose and counted as `skipped`. Nothing to drain; do not go looking.
3. **The chase list** — 107 commitments are owed *to* us. Draft the chase in `info@` as an unsent draft, exactly as `leads/draft-reply.ts` already does.
4. **Fill the project-value bounds** on `/company` (`min_project_value`, `sweet_spot_value`, `max_project_value`) — the last real gap in the pursuit profile, which is otherwise well populated as of 2026-09-24. Everything else that line used to list is done.
5. Optionally persist `fit_assessment` on `proposal_intake_sessions` (currently returned in the intake response but not stored).
6. Tend the known debt in §9 as it gets in the way.

### Recent sessions

Newest first; full entries in `docs/BUILD-LOG.md`.

- **10-08** — simplification pass: a working intake deduper that had never been wired to anything (and would have rewritten a meeting into an email proposal once it was), four byte-identical copies of one database client, a local-model call capped at the Gemini guard, and the Monday task digest retired into Pepper — whose channel nothing on the health page had ever watched (DEPLOYED)
- **10-08** — Delta's three vehicles stood up with Ber Wilson flagged as sponsor and the splits deliberately blank, the land owner filed as a seller rather than a holder; the bootstrap extracted out of its route so a script can call it. ⚠ Found by the read-back: a correctly flagged Ber Wilson row with no percentage yet was told its flag was missing (DEPLOYED + PUSHED)
- **10-08** — a commitment goes into a vehicle, not an entity, and the raise pipeline stopped being confused with the cap table; a program stopped being counted twice against its own sub-projects; a vehicle's paperwork hangs off its legal entity; `/vehicles` reads every cap table at once. ⚠ Found: an spv-targeted commitment's NULL `project_id` let a protected deal's capital into the sent daily brief (DEPLOYED + MIGRATED + PUSHED)
- **10-08** — every recorded meeting becomes a record the agent can read: 3 of 5 transcripts had been filed nowhere, no import had ever written to `meetings`, and the title-learning built this session would have learned the model's rewrite rather than the organizer's own title (DEPLOYED + MIGRATED)
- **10-06** — an SPV becomes a record on the project, with the people in it: participants, equity splits and capital raise as one ledger, our share derived rather than typed, and two routes on the Economics tab that had never once worked (DEPLOYED + MIGRATED)
- **10-05** — a deal economics calculator: how big is this deal and how much of it is ours. 97 tests where there were none, an unlabelled $57.65B column retired, and four engine defects found by running it (DEPLOYED + MIGRATED)
- **10-05** — debug pass: a bracket in a record's name made it unfindable and the query reported no error, a document stranded mid-pass for 13 days read as a pass that was running, 230 focus rings fired on mouse clicks, and the off-box GitHub backup had been failing for four days (DEPLOYED + PUSHED)
- **10-03** — the Dino lead lanes turned on (a Drive folder id that could not be typed into the screen; a commit that did not build because the runbook builds the working tree), and a division became a view you can link to — `/leads?route=<key>`, plus the trade divisions as a collapsible list in the sidebar, driven by the registry (DEPLOYED, NOT PUSHED)
- **10-01** — CLAUDE.md pruned 143k → 110k against the 150k truncation limit: open items split to `docs/OPEN-ITEMS.md`, §12 compressed and re-filed, §9's resolved entries retired
- **09-30** — a project can be protected: containment everywhere, and a local-TOTP step-up to open it (DEPLOYED + MIGRATED)
- **09-30** — a departure becomes a record instead of a deletion: the personnel, corporate and compliance registers, and an audit trail on the tables that had none (DEPLOYED + MIGRATED)
- **09-30** — deal documents stopped answering as company knowledge; a filing decision finally sticks (DEPLOYED + MIGRATED)
- **09-30** — a line of business is a row, not a code change: lead routing becomes a registry (DEPLOYED + MIGRATED)
- **09-30** — the national rail network on /map: 302,771 lines as vector tiles, and a STRACNET flag that is not a yes/no (DEPLOYED)
- **09-30** — an intake package can be sent to the project it is already about, and merging stopped throwing the run away (DEPLOYED)
- **09-30** — a line of business is a row, not a code change: lead routing becomes a registry, and Dino becomes two lanes (DEPLOYED + MIGRATED)
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

Older sessions are not listed here. **`docs/BUILD-LOG.md` is the complete, dated history** — this list is a two-week window, because the file is a reference and not a journal. ⚠ **MEASURE IT IN CHARACTERS, NOT BYTES, AND THE PRUNE IS NOW OVERDUE.** The limit is 150,000 **characters**; every figure recorded here before 2026-10-08 came from `wc -c`, which counts **bytes** — and this file's `⚠ § — ’` are multi-byte, so `wc -c` overstates by ~2k. Measure with `python3 -c "print(len(open('CLAUDE.md').read()))"`. **Measured 2026-10-08 after three sessions in one day: ~135,000 characters, ~15,000 of headroom — roughly four sessions at the measured rate of ~5k a session.** (Rounded on purpose: writing an exact figure into the file it measures changes it, so the precision would be false.) §12 is 60.4k of it and has held at **45% of the whole file** across every measurement since 10-06 (56k of 124k, then 58.5k of 129k, then 60.4k of 134k), and its Postgres group alone is 12.4k. Recent sessions is 6.3k across 45 entries — 139 characters each, already dense, and trimming it to a two-week window recovered **under 1k** when tried on 10-06. So the arithmetic has not changed and will not: **the only real prune is §12, and the next session that opens this file should do it before building anything.** Three consecutive sessions have now passed the 125k threshold without pruning, each adding rules that met the bar — which is the bar working, and also why the file keeps growing. Retiring a hard-won rule is Richard's call, not a session's. ⚠ **AND THIS PARAGRAPH IS THE SAME FAILURE IN MINIATURE:** it held three stacked measurement notes from three sessions, ~1,950 characters, two of them stale — a journal where one current statement belongs. Replace it; never append to it.
---

## AT THE END OF EVERY SESSION

Write the full entry to **`docs/BUILD-LOG.md`** (newest first, same voice and detail as the entries already there — the measurements and the ⚠ findings are the point).

In **`CLAUDE.md`**, update only:
- one line under **Recent sessions**,
- any genuinely new durable rule in **§12** — but hold it to the bar below,
- **§9** if debt was resolved, and the reference sections (§1–§11) if the architecture actually moved.

Open items go in **`docs/OPEN-ITEMS.md`**; promote a row into §13 only when it needs a decision from Richard.

**THE BAR FOR A NEW §12 RULE.** Measured 2026-10-01 across the twelve commits from 09-29: the file took on **~5,400 characters per commit**, of which **~3,200 was §12 — about five new rules each time**, at ~650 characters apiece. That rate is what put the file 7k from silent truncation in four days, so the rule for adding rules is:

- **Grep §12 first.** If an existing rule covers it, extend that line — do not add a sibling. Several near-duplicates have been merged out already.
- **Ask whether it is a rule or a finding.** *"`.neq()` is NULL for a NULL column"* changes how code gets written here and belongs in §12. *"NARN's `BRANCH` holds the literal `#N\A` 42,448 times"* is a fact about one dataset — it belongs in `docs/BUILD-LOG.md`, where the session that next touches that dataset will grep for it. When in doubt it is a finding.
- **One rule is one bullet: the claim, the fix, the date.** The evidence, the measurement and the story go in the log. §12's floor is ~290 characters a rule; anything much past that is narrative that has escaped.
- **A rule that cost no hours is not a hard-won rule.**

**CLAUDE.md is a reference, not a journal.** It is loaded in full at the start of every session and is silently truncated above 150,000 characters — which is how a project loses its own operating instructions without anything reporting an error. **It was 143k on 2026-10-01 and was cut to 110k**; two sessions on 2026-09-30 added 5k between them, so that headroom is roughly eight sessions. **Re-measure at 125k** — that is roughly twelve commits' headroom at the measured §12 rate, and the prune is cheaper done early than at 148k mid-feature. Measure before pruning — the bloat has never once been where the rule assumed it was. On 10-01 **Recent sessions was 5.5k and entirely inside two weeks**, while §12 and the open-items table held 85k of the 143k.
