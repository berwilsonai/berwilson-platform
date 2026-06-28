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
| Database + Auth | Supabase (Postgres, Auth, Storage, Realtime) | US region. RLS enabled on every table (but see §8 — app traffic uses the service role). pgvector enabled. |
| Frontend | Next.js 16 (App Router, TypeScript) on Vercel | Server components default. Client only for interactivity. |
| Styling | Tailwind CSS v4 + shadcn/ui (`@base-ui/react`) | No custom CSS unless unavoidable. |
| Runtime AI | **Google Gemini** (`@google/generative-ai`) | All runtime AI. See §5. |
| Charts | Recharts | Equity + dashboards. |
| PDF | `@react-pdf/renderer` | Equity scenario exports. |
| Client data/state | `@tanstack/react-query`, `zustand` | Equity module only. |
| Microsoft Graph | Microsoft Graph API (OAuth) | Powers `/calendar` meeting prep + party enrichment. The email-to-task ingestion scraper was removed 2026-06-25; OAuth + `email_tokens` retained for calendar. |
| Vector Search | pgvector inside Supabase Postgres | `gemini-embedding-001`, 768-dim. |
| File Storage | Supabase Storage (`documents` bucket) | Organized by project / entity / site ID. |
| Deployment | Vercel + Supabase | No containers, no Docker, no servers. |

### AI Model Rules (CURRENT)

Runtime AI is **Gemini only**. Anthropic Claude is **no longer used at runtime** (the old `claude.ts` wrapper and the `@anthropic-ai/sdk` dependency were removed 2026-06-22).

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
│   ├── portfolio/            # Site portfolio hierarchy (sites → capital/compliance/components/stakeholders)
│   ├── equity/               # Equity & valuation suite (cap table, exit scenarios, investor deal,
│   │                         #   valuation, originator fees, shareable scenarios)
│   ├── login/, auth/         # Auth
│   └── api/                  # ~85 route handlers (see below)
├── components/               # Feature-grouped UI (projects/, dashboard/, equity/, portfolio/,
│                             #   contacts/, vendors/, intel/, agent/, review/, layout/, ui/, shared/)
├── lib/
│   ├── ai/                   # gemini.ts, agent.ts, agent-tools.ts, embeddings.ts, research.ts,
│   │                         #   proposal-matching.ts, prompts/*
│   ├── email/                # pipeline.ts, participants.ts
│   ├── equity/               # calculations/*, constants.ts, format.ts, pdf/*
│   ├── integrations/         # microsoft-graph.ts, procore.ts (stub), types.ts
│   ├── supabase/             # client.ts, server.ts (RLS), admin.ts (service role), types.ts
│   ├── risk-scoring.ts, rate-limit.ts
│   └── utils/                # constants, sectors, stages, activity
├── hooks/                    # use-stored-state, equity-* hooks
└── types/                    # database.ts (GENERATED — source of truth), domain.ts, equity-domain.ts
```

**API routes** live under `src/app/api/`. Major groups: `ai/*` (extract, classify, synthesize, brief, draft, agent, research, meeting-prep), `proposals/*` (intake, confirm, upload-chunk), `documents/*`, `projects/*`, `parties/*`, `entities/*`, `portfolio/*`, `equity/*`, `email/*`, `cron/*`, plus per-resource CRUD.

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
- **Directory:** `parties` (people + orgs via `is_organization`), `contact_aliases`, `entities` (legal entities/vendors), `entity_projects`, `party_entities`, `entity_reviews`, `federal_scorecards`, `certifications`.
- **Company:** `company_profile`, `media`, `trade_secrets`, `ts_exposure_items`.
- **AI / intelligence:** `ai_queries`, `chunks` (pgvector), `agent_conversations`, `agent_messages`, `research_artifacts`, `review_queue`, `risk_scores`, `proposal_intake_sessions`, `stored_briefs`, `portfolio_briefs`.
- **Microsoft Graph:** `email_tokens` (OAuth — calendar/enrichment), `document_distributions`. (`processed_emails`, `graph_subscriptions` are now unused after the email-scraper removal — safe to drop.)
- **Portfolio (site hierarchy):** `sites`, `components`, `funding_sources`, `revenue_share_agreements`, `stakeholder_interactions`, `stakeholder_relationships`, `corridors`, `rail_branches`, `sub_engagements`, `brands`, `dream_quotes`.
- **Equity:** `equity_scenarios`, `equity_share_links`.
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
- TypeScript strict mode. Avoid `any` — the codebase has accumulated ~115 `any`/cast escapes from schema drift; don't add more, and prefer regenerating types over casting.
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
GEMINI_API_KEY=                  # all runtime AI + embeddings
MICROSOFT_TENANT_ID=             # email ingestion
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_WEBHOOK_SECRET=
```
`ANTHROPIC_API_KEY` and `PERPLEXITY_API_KEY` are no longer used — remove from any new env files.

### Git
- Main branch: `main` (this is the live-deploy branch — pushing to it deploys to Vercel production).
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`. Never commit `.env.local`.

---

## 8. SECURITY / COMPLIANCE

- Middleware (`middleware.ts`) gates every route: unauthenticated users are redirected to `/login`. Public exceptions: login/auth, the Graph webhook, cron endpoints, and token-gated equity share links.
- **RLS is defense-in-depth, not the active boundary.** App traffic — including ~33 server pages — uses the service-role admin client (`lib/supabase/admin.ts`), which bypasses RLS. The auth boundary is the middleware. This is an accepted trade-off for a 2-user internal tool; if the team grows or sensitive data lands, move pages to the RLS-respecting server client (`lib/supabase/server.ts`).
- `documents.classification` flags standard vs sensitive. All AI calls logged to `ai_queries`.
- US-only infrastructure. **Do not store CUI** until a GovCloud migration is done. GovCloud trigger: annual DoD revenue > $2M OR a contract requiring CMMC L2. Stack is portable by design (standard Postgres, no vendor lock-in).

---

## 9. KNOWN DEBT / AUDIT NOTES (2026-06-22)

Captured so future sessions don't rediscover them:
- **Scope sprawl.** ~55K lines / 19 nav destinations for a 2-person CRM. The **Equity** (~4.6K lines) and **Portfolio** (~3K lines) modules are large, mostly self-contained, and arguably off the core mission. Decision (Richard, 2026-06-22): **keep both for now**, just clean up. Revisit if maintenance cost bites.
- **Overlapping "attention" surfaces.** `/dashboard`, `/attention`, `/capacity`, `/timeline`, `/review` plus several dashboard panels all answer "what needs me today." Candidate for consolidation to dashboard + review.
- **Three directory concepts** (Contacts/parties, Vendors/entities, Portfolio stakeholders) overlap. Original intent (§10) was one `parties` directory; code drifted.
- **Type drift.** Generated types lag the schema; recurring inline casts (`project as { … }`). Regenerate and fix.
- **Speculative early-build features** (Procore stub, eval system, background-check/enrichment scaffolding) exist ahead of need.
- **Legacy `action_items`.** The old task store (JSON on `updates`) still exists and still powers `/attention`, `/capacity`, `/calendar`, and the AI brief/draft/meeting-prep routes. The new `tasks` table is the real task system; these surfaces should be migrated onto it (and the dead `action_items` data eventually retired). Old email-era tables `processed_emails`/`graph_subscriptions` and the `updates.outlook_web_link` column are now unused — safe to drop in a future migration.
- **`team_members` is a 4th people-concept** (alongside parties/entities/stakeholders), deliberately kept tiny and separate so task assignment stays fast. If the team-vs-contact overlap ever matters, reconcile with `parties`.

---

## 10. CONTACTS / DIRECTORY (original intent)

`parties` is the global contact directory. People and organizations both live here (`is_organization=true` for firms). A party is global — editing it updates everywhere. Contact detail shows: bio/contact info, every project they're linked to (via `project_players`) with role, updates/documents mentioning them, DD items assigned, compliance items owned. Routes: `/contacts`, `/contacts/[id]`.

Note the drift flagged in §9: `entities`/vendors and portfolio `stakeholders` partly duplicate this. When touching directory code, prefer consolidating toward `parties`.

---

## 11. DO NOT

- Add a separate vector database (pgvector is fine for years).
- Use LangChain, LlamaIndex, or any AI orchestration framework.
- Build microservices, use Docker/containers, or add Prisma/Drizzle (Supabase client + generated types only).
- Reintroduce a second AI provider SDK — runtime AI is Gemini. (Removing Anthropic was deliberate.)
- Pre-build features for future phases.
- Store CUI until GovCloud migration is complete.
- Re-add the email-to-task scraper — it was deliberately removed 2026-06-25 (tasks are now manually created in the team task system). Microsoft Graph is kept for calendar/enrichment only.

---

## 12. BUILD STATUS

**Reality:** well beyond the original Phase 1/2 plan. Live and in daily use on Vercel production.

**Working:** projects (CRUD, pipeline/program views, hierarchy, all detail tabs), **opportunities** (new — see below), dashboard, attention/timeline/capacity, **team tasks**, contacts + vendors directories, company profile (thin), review queue, activity log, manual-paste extraction, intel (RAG + agent), proposal intake → assessment → project creation, portfolio site hierarchy, equity & valuation suite. **Calendar/meeting-prep still uses Microsoft Graph (OAuth retained); the email-to-task scraper was removed (see below).**

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
1. **Populate the pursuit profile** on `/company` with Ber Wilson's real criteria (only Richard has these facts — don't invent them). This is what makes the fit assessment trustworthy.
2. Optionally persist `fit_assessment` on `proposal_intake_sessions` (currently returned in the intake response but not stored).
3. Tend the known debt in §9 as it gets in the way.

> UPDATE THIS SECTION (and §9 if you resolve debt) at the end of every Claude Code session.
