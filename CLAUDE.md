# BER WILSON — Executive Intelligence Platform
# Master Architecture & Build Reference (CLAUDE.md)
# Version: 1.0 | 2026-04-28

---

## WHAT THIS FILE IS

This is the canonical reference for every Claude Code session working on the Ber Wilson platform. It lives in the project root as `CLAUDE.md`. Claude Code reads it automatically.

**Builder:** Richard (EVP, Ber Wilson) — builds in Claude Code terminal. Not a developer.
**Golden rule:** Never introduce complexity without demonstrated need. Every decision reversible or portable.

---

## 1. PROJECT IDENTITY

**Company:** Ber Wilson — vertically integrated construction, development, and USA prefab steel manufacturing. Salt Lake City, UT.
**Website:** berwilson.com
**Platform:** Internal executive intelligence tool for two executives managing a multi-sector construction pipeline (government contracting, large-scale infrastructure, real estate development, prefab manufacturing, institutional).
**Core problem:** Two people managing billions in pipeline across federal bids, PE negotiations, JV structures, subcontractor relationships, and manufacturing coordination. They need a single AI-powered source of truth that thinks like a construction COO.

---

## 2. TECH STACK

| Layer | Technology | Notes |
|-------|-----------|-------|
| Database + Auth | Supabase (Postgres, Auth, Storage, Realtime) | US region. RLS on every table. pgvector enabled. |
| Frontend | Next.js 14+ (App Router, TypeScript) on Vercel | Server components default. Client only for interactivity. |
| Styling | Tailwind CSS + shadcn/ui | No custom CSS unless unavoidable. |
| AI — Extraction | Claude API, **Haiku 4.5** | Email parsing, classification, entity extraction, chunk generation. ~90% of API calls. |
| AI — Synthesis | Claude API, **Sonnet 4.6** | Executive briefs, cross-project analysis, agent responses. ~10% of API calls. |
| External Research | Perplexity API (`sonar-pro`) | Due diligence, market scans, public-source verification. Phase 2+. |
| Email Ingestion | Microsoft Graph API + webhook subscriptions | Push-based. M365 Business Basic already covers API access. Phase 2. |
| Vector Search | pgvector inside Supabase Postgres | No separate vector DB until >500K chunks. |
| File Storage | Supabase Storage | Documents organized by project ID. |
| Deployment | Vercel + Supabase | No containers, no Docker, no servers. |

### AI Model Rules

- **Haiku 4.5** → Structured input/output tasks: email parsing, document classification, entity extraction, confidence scoring, embedding generation, chunk creation.
- **Sonnet 4.6** → Reasoning tasks: executive summaries, cross-project analysis, agent recommendations, document drafting, risk assessment.
- **Opus** → Never at runtime. Architecture planning only.
- **Perplexity sonar-pro** → Current web information: company backgrounds, regulatory updates, market data, public record verification.

### Integration Abstraction

All external integrations (Procore, future CRM/ERP) go through `src/lib/integrations/`. Each integration has a typed interface defined before implementation. Procore gets a stub interface in Phase 1 — no implementation until subscribed, but the contract is locked.

---

## 3. PROJECT STRUCTURE

```
berwilson-platform/
├── CLAUDE.md
├── .env.local                        # never committed
├── .env.example
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── middleware.ts                      # Supabase auth guard
├── supabase/
│   ├── config.toml
│   └── migrations/
│       ├── 00001_extensions.sql
│       ├── 00002_enums.sql
│       ├── 00003_core_tables.sql
│       ├── 00004_rls_policies.sql
│       ├── 00005_activity_triggers.sql
│       └── ...
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # Root: sidebar, header, auth provider
│   │   ├── page.tsx                   # Redirect → /dashboard
│   │   ├── login/page.tsx
│   │   ├── dashboard/page.tsx         # Portfolio overview
│   │   ├── projects/
│   │   │   ├── page.tsx               # List with filters
│   │   │   └── [id]/
│   │   │       ├── layout.tsx         # Tab navigation shell
│   │   │       ├── page.tsx           # Overview (default tab)
│   │   │       ├── players/page.tsx
│   │   │       ├── updates/page.tsx
│   │   │       ├── documents/page.tsx
│   │   │       ├── milestones/page.tsx
│   │   │       ├── financing/page.tsx
│   │   │       └── diligence/page.tsx
│   │   ├── review/page.tsx            # Review queue
│   │   ├── activity/page.tsx          # Activity log
│   │   ├── intel/page.tsx             # AI query (Phase 3)
│   │   └── api/
│   │       ├── ai/
│   │       │   ├── extract/route.ts
│   │       │   ├── classify/route.ts
│   │       │   ├── synthesize/route.ts    # Phase 3
│   │       │   └── research/route.ts      # Phase 2
│   │       ├── email/
│   │       │   └── webhook/route.ts       # Phase 2
│   │       └── webhooks/
│   │           └── procore/route.ts       # Phase 4 stub
│   ├── components/
│   │   ├── ui/                        # shadcn/ui
│   │   ├── layout/
│   │   │   ├── AppSidebar.tsx
│   │   │   ├── AppHeader.tsx
│   │   │   └── MobileNav.tsx
│   │   ├── dashboard/
│   │   │   ├── ProjectCard.tsx
│   │   │   ├── StageIndicator.tsx
│   │   │   ├── ActionItemsSummary.tsx
│   │   │   └── ReviewQueueBadge.tsx
│   │   ├── projects/
│   │   │   ├── ProjectForm.tsx
│   │   │   ├── PlayersTab.tsx
│   │   │   ├── UpdatesTab.tsx
│   │   │   ├── DocumentsTab.tsx
│   │   │   ├── MilestonesTab.tsx
│   │   │   ├── FinancingTab.tsx
│   │   │   └── DiligenceTab.tsx
│   │   ├── review/
│   │   │   ├── ReviewItem.tsx
│   │   │   └── ReviewActions.tsx
│   │   ├── intel/                     # Phase 3
│   │   │   ├── QueryInput.tsx
│   │   │   ├── GroundedAnswer.tsx
│   │   │   └── CitationCard.tsx
│   │   └── shared/
│   │       ├── ConfidenceBadge.tsx
│   │       ├── SourceTag.tsx
│   │       ├── PasteInput.tsx
│   │       ├── EmptyState.tsx
│   │       └── LoadingSkeleton.tsx
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts              # createBrowserClient()
│   │   │   ├── server.ts              # createServerClient()
│   │   │   ├── admin.ts               # createServiceRoleClient() — API routes only
│   │   │   └── types.ts               # Re-exports generated types
│   │   ├── ai/
│   │   │   ├── claude.ts              # Unified client, model routing built-in
│   │   │   ├── perplexity.ts          # Perplexity wrapper
│   │   │   ├── embeddings.ts          # Text → vector
│   │   │   └── prompts/
│   │   │       ├── extraction.ts
│   │   │       ├── classification.ts
│   │   │       ├── synthesis.ts       # Phase 3
│   │   │       └── agent.ts           # Phase 4
│   │   ├── integrations/
│   │   │   ├── types.ts               # Interfaces defined Phase 1
│   │   │   └── procore.ts             # Stub
│   │   └── utils/
│   │       ├── stages.ts
│   │       ├── sectors.ts
│   │       └── activity.ts
│   └── types/
│       ├── database.ts                # Generated by Supabase CLI
│       └── domain.ts                  # App-level types
└── scripts/
    ├── seed.ts                        # 3 realistic test projects
    └── gen-types.ts                   # Runs supabase gen types
```

---

## 4. DATABASE SCHEMA

All PKs: `id uuid default gen_random_uuid() primary key`. All timestamps: `timestamptz default now()`, UTC. Every table gets RLS. `activity_log` is append-only — no UPDATE or DELETE policies ever.

### Enums

```sql
create type project_sector as enum ('government','infrastructure','real_estate','prefab','institutional');
create type project_status as enum ('active','on_hold','won','lost','closed');
create type project_stage as enum ('pursuit','capture','bid','award','mobilization','execution','closeout');
create type update_source as enum ('email','manual_paste','document','agent','procore');
create type review_state as enum ('pending','approved','rejected');
create type dd_severity as enum ('info','watch','critical','blocker');
create type compliance_status as enum ('not_started','in_progress','compliant','non_compliant','waived');
create type entity_type as enum ('llc','corp','jv','subsidiary','trust','fund','other');
```

### Tables

```sql
-- People and organizations across all projects
create table parties (
  id uuid default gen_random_uuid() primary key,
  full_name text not null,
  company text,
  title text,
  email text,
  phone text,
  relationship_notes text,
  is_organization boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Legal entities, subsidiaries, JV structures
create table entities (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  entity_type entity_type not null,
  jurisdiction text,
  parent_entity_id uuid references entities(id),
  ownership_pct numeric(5,2),
  formation_date date,
  ein text,
  notes text,
  created_at timestamptz default now()
);

-- Master project record
create table projects (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  sector project_sector not null,
  status project_status default 'active',
  stage project_stage default 'pursuit',
  description text,
  estimated_value numeric(15,2),
  contract_type text,           -- FFP, CPFF, T&M, GMP, lump_sum, cost_plus
  delivery_method text,         -- design_build, design_bid_build, cmar
  location text,
  client_entity text,
  solicitation_number text,     -- government projects
  award_date date,
  ntp_date date,
  substantial_completion_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Junction: parties linked to projects with role context
create table project_players (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  party_id uuid references parties(id) on delete cascade not null,
  role text not null,           -- owner_rep, sub_gc, co_kor, pe_partner, architect, etc.
  is_primary boolean default false,
  notes text,
  created_at timestamptz default now(),
  unique(project_id, party_id, role)
);

-- Gate tracker: pursuit through closeout
create table milestones (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  stage project_stage not null,
  label text not null,
  target_date date,
  completed_at timestamptz,
  notes text,
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- File references (files live in Supabase Storage)
create table documents (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  storage_path text not null,
  file_name text not null,
  file_size_bytes bigint,
  mime_type text,
  doc_type text,                -- proposal, contract, drawing, email, report, correspondence, other
  classification text default 'standard',  -- standard or sensitive
  ai_summary text,
  confidence numeric(3,2),
  source update_source default 'document',
  uploaded_by uuid,
  uploaded_at timestamptz default now()
);

-- Parsed updates from email, paste, or document ingestion
create table updates (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  source update_source not null,
  source_ref text,              -- email message_id, document_id, etc.
  raw_content text not null,
  summary text,
  action_items jsonb default '[]',     -- [{text, assignee, due_date, completed}]
  waiting_on jsonb default '[]',       -- [{text, party, since}]
  risks jsonb default '[]',            -- [{text, severity, mitigation}]
  decisions jsonb default '[]',        -- [{text, made_by, date}]
  confidence numeric(3,2),
  review_state review_state default 'approved',  -- manual pastes auto-approve
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- Text chunks with pgvector embeddings for RAG
create table chunks (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  document_id uuid references documents(id) on delete set null,
  update_id uuid references updates(id) on delete set null,
  content text not null,
  embedding vector(1536),
  chunk_index integer not null,
  token_count integer,
  created_at timestamptz default now(),
  constraint chunks_source_check check (document_id is not null or update_id is not null)
);

-- Due diligence flags
create table dd_items (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  category text not null,       -- legal, regulatory, partner_dd, title, environmental, bonding
  item text not null,
  status text default 'open',   -- open, in_progress, resolved, accepted_risk
  severity dd_severity default 'info',
  assigned_to uuid references parties(id),
  notes text,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

-- Capital stack and financing
create table financing_structures (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  structure_type text,          -- pe_partnership, jv_equity, conventional, bond_financed, self_funded
  senior_debt numeric(15,2),
  mezzanine numeric(15,2),
  equity_amount numeric(15,2),
  equity_pct numeric(5,2),
  ltv numeric(5,2),
  interest_rate numeric(5,3),
  lender text,
  pe_partner text,
  waterfall_notes text,
  draw_schedule jsonb,          -- [{milestone, amount, drawn, date}]
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- CMMC, Davis-Bacon, bonding, certifications
create table compliance_items (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,  -- null = company-wide
  framework text not null,      -- cmmc, davis_bacon, bonding, dbe_eeo, far_dfars, state_license
  requirement text not null,
  status compliance_status default 'not_started',
  due_date date,
  responsible_party uuid references parties(id),
  evidence_doc_id uuid references documents(id),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Entity-project relationships
create table entity_projects (
  id uuid default gen_random_uuid() primary key,
  entity_id uuid references entities(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade not null,
  relationship text not null,   -- owner, jv_partner, sub_entity, guarantor
  equity_pct numeric(5,2),
  notes text,
  created_at timestamptz default now(),
  unique(entity_id, project_id, relationship)
);

-- APPEND-ONLY audit trail
create table activity_log (
  id uuid default gen_random_uuid() primary key,
  actor_id uuid,                -- null for system/AI
  actor_type text default 'user',  -- user, system, ai
  action text not null,
  table_name text not null,
  record_id uuid,
  project_id uuid references projects(id),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Low-confidence items awaiting review
create table review_queue (
  id uuid default gen_random_uuid() primary key,
  source_table text not null,
  record_id uuid not null,
  project_id uuid references projects(id),
  reason text not null,         -- low_confidence, ambiguous_project, unknown_party, conflicting_data
  confidence numeric(3,2),
  ai_explanation text,
  reviewed_by uuid,
  resolution text,              -- approved, rejected, edited
  resolved_at timestamptz,
  created_at timestamptz default now()
);

-- AI query/response log
create table ai_queries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  query_text text not null,
  response_text text not null,
  cited_records jsonb default '[]',
  model_used text not null,
  prompt_version text,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  created_at timestamptz default now()
);

-- Perplexity research results
create table research_artifacts (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id),
  query_text text not null,
  response_text text not null,
  source_urls jsonb default '[]',
  model_used text,
  retrieved_at timestamptz default now()
);
```

### Key Indexes

```sql
create index idx_projects_status on projects(status);
create index idx_projects_sector on projects(sector);
create index idx_projects_stage on projects(stage);
create index idx_updates_project on updates(project_id, created_at desc);
create index idx_updates_review on updates(review_state) where review_state = 'pending';
create index idx_documents_project on documents(project_id);
create index idx_chunks_project on chunks(project_id);
create index idx_chunks_embedding on chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index idx_activity_project on activity_log(project_id, created_at desc);
create index idx_review_pending on review_queue(resolved_at) where resolved_at is null;
create index idx_milestones_project on milestones(project_id, sort_order);
create index idx_dd_project on dd_items(project_id);
create index idx_compliance_project on compliance_items(project_id);
create index idx_players_project on project_players(project_id);
create index idx_players_party on project_players(party_id);
```

### Triggers

```sql
-- Auto-update updated_at
create or replace function update_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- Apply to all tables with updated_at
create trigger set_updated_at before update on parties for each row execute function update_updated_at();
create trigger set_updated_at before update on projects for each row execute function update_updated_at();
create trigger set_updated_at before update on financing_structures for each row execute function update_updated_at();
create trigger set_updated_at before update on compliance_items for each row execute function update_updated_at();

-- Auto-insert activity_log
create or replace function log_activity() returns trigger as $$
begin
  insert into activity_log (actor_id, actor_type, action, table_name, record_id, project_id, metadata)
  values (
    auth.uid(), 'user', TG_OP, TG_TABLE_NAME,
    coalesce(new.id, old.id),
    case
      when TG_TABLE_NAME = 'projects' then coalesce(new.id, old.id)
      when new is not null and new.project_id is not null then new.project_id
      else null
    end,
    case TG_OP
      when 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
      when 'DELETE' then to_jsonb(old)
      else to_jsonb(new)
    end
  );
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

-- Apply to tracked tables
create trigger log_projects after insert or update or delete on projects for each row execute function log_activity();
create trigger log_updates after insert or update or delete on updates for each row execute function log_activity();
create trigger log_documents after insert or update or delete on documents for each row execute function log_activity();
create trigger log_milestones after insert or update or delete on milestones for each row execute function log_activity();
create trigger log_dd_items after insert or update or delete on dd_items for each row execute function log_activity();
create trigger log_review after insert or update or delete on review_queue for each row execute function log_activity();
create trigger log_financing after insert or update or delete on financing_structures for each row execute function log_activity();
create trigger log_compliance after insert or update or delete on compliance_items for each row execute function log_activity();
```

### RLS Pattern

```sql
-- Every table uses this pattern:
alter table {table_name} enable row level security;
create policy "{table}_select" on {table_name} for select using (auth.role() = 'authenticated');
create policy "{table}_insert" on {table_name} for insert with check (auth.role() = 'authenticated');
create policy "{table}_update" on {table_name} for update using (auth.role() = 'authenticated');
create policy "{table}_delete" on {table_name} for delete using (auth.role() = 'authenticated');

-- EXCEPTION: activity_log — NO update or delete
alter table activity_log enable row level security;
create policy "activity_select" on activity_log for select using (auth.role() = 'authenticated');
create policy "activity_insert" on activity_log for insert with check (auth.role() = 'authenticated');
```

---

## 5. AI ARCHITECTURE

### Unified Claude Client

Single wrapper at `src/lib/ai/claude.ts`. Model selection by task type. Every call logged to `ai_queries`.

```
task === 'extract' | 'classify' | 'embed' → Haiku 4.5
task === 'synthesize' | 'agent'           → Sonnet 4.6
```

### Extraction Prompt Shape

All extraction prompts return structured JSON. Schema specified in prompt. Haiku handles reliably.

```
SYSTEM: You are an extraction engine for a construction executive intelligence platform.
Given raw text, extract:
- summary: 2-3 sentence summary
- action_items: [{text, assignee?, due_date?}]
- waiting_on: [{text, party?, since?}]
- risks: [{text, severity: info|watch|critical|blocker}]
- decisions: [{text, made_by?, date?}]
- mentioned_parties: [{name, company?, role?}]
- mentioned_projects: [{name_or_ref, confidence: 0-1}]
- confidence: 0-1 overall extraction quality
Return ONLY valid JSON. No explanation. No markdown.
```

### Hybrid Retrieval (Phase 3)

```
1. Parse query → extract: project names, sectors, stages, date ranges, entities
2. SQL filter: chunks WHERE project_id IN (matched) AND created_at > range
3. Vector: ORDER BY embedding <=> query_embedding LIMIT 20 (within filtered set)
4. Re-rank: recency (0.3) + confidence (0.3) + cosine_sim (0.4)
5. Top 8 chunks → Sonnet context window
6. Generate: every factual claim must cite [chunk_id]
7. Log: query + response + citations → ai_queries
```

### Construction Executive Agent (Phase 4)

Domain-expert persona: senior EVP/COO, 25+ years government contracting, large-scale development, design-build GC, prefab, construction finance. Not a consultant — an owner-operator.

Decision framework (four lenses on every recommendation):
1. **Commercial:** Can we win it?
2. **Operational:** Can we deliver it?
3. **Financial:** Can we get paid, and with what margin?
4. **Compliance:** Can we protect the downside?

Response protocol: Situation → Risks → Recommendation → Next Decision.
Hard rules: Never ungrounded guesses. Never hide risk. Never substitute for legal/tax counsel. Always distinguish facts, estimates, and judgments.

---

## 6. PHASED BUILD PLAN

### Phase 1: Foundation
**Goal:** Both executives using it daily.
**Scope:** Auth, projects CRUD, project detail tabs (overview/players/updates/documents/milestones/financing/diligence), manual paste + Haiku extraction, document upload, review queue, activity log, executive dashboard.
**AI:** Haiku for paste extraction only.
**NOT included:** Email, vector search, synthesis, agent, Procore.

### Phase 2: Intelligence Ingestion
**Goal:** Email auto-populating project folders.
**Scope:** Microsoft Graph API + webhook subscriptions, email parsing pipeline, attachment processing, AI classification, confidence scoring, Perplexity research, enhanced review workflow.
**AI:** Haiku for parsing/classification. Perplexity for research.
**Trigger:** Phase 1 stable + daily use.

### Phase 3: Query & Synthesis
**Goal:** AI-generated briefs replacing manual status reporting.
**Scope:** Natural-language search (hybrid retrieval), grounded answers with citations, saved queries, executive briefs, cross-project synthesis.
**AI:** Haiku for embeddings. Sonnet for synthesis/briefs.
**Trigger:** 50+ updates across projects.

### Phase 4: Executive Agent + Integrations
**Goal:** Agent handling first-draft recommendations on live pursuits.
**Scope:** Tool-using agent (Sonnet), project-scoped chat, drafting workflows, Procore integration, evaluation harness.
**AI:** Sonnet for agent. Haiku for tool preprocessing.
**Trigger:** Phase 3 proven valuable.

---

## 7. CONVENTIONS

### Code
- TypeScript strict mode
- Server components default; `'use client'` only when interactive
- All DB queries through Supabase client — no raw SQL in components
- API routes handle AI + mutations; pages fetch via server components
- Error boundary + `loading.tsx` skeleton on every route

### Naming
- Database: `snake_case` (tables, columns, enums)
- TypeScript: `camelCase` (vars/functions), `PascalCase` (types/components)
- Files: `kebab-case` (non-components), `PascalCase` (components)
- API routes: `kebab-case` paths

### Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
PERPLEXITY_API_KEY=              # Phase 2
MICROSOFT_TENANT_ID=             # Phase 2 — from Azure AD app registration
MICROSOFT_CLIENT_ID=             # Phase 2
MICROSOFT_CLIENT_SECRET=         # Phase 2
MICROSOFT_WEBHOOK_SECRET=        # Phase 2 — for validating Graph API notifications
```

### Git
- Main branch: `main`
- Feature branches: `phase-1/auth`, `phase-1/projects-crud`, etc.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`
- Never commit `.env.local`

---

## 8. CMMC & COMPLIANCE

### Phase 1 (Now)
- RLS on every table from migration 001
- Append-only `activity_log` with triggers
- `classification` field on documents (standard vs sensitive)
- MFA-ready auth config
- US-only infrastructure (Supabase us-east-1, Vercel)
- All AI calls logged

### Later
- Formal retention policies
- Field-level encryption for financing data
- Role-based access matrix when team grows
- Dependency auditing

### GovCloud Migration Trigger
When annual DoD revenue > $2M OR a contract requires CMMC L2. Stack is portable by design — standard Postgres, no vendor lock-in.

---

## 9. PROCORE DESIGN

### Phase 1: Interface Only
```typescript
interface ConstructionDataProvider {
  getProjectStatus(externalId: string): Promise<ProjectStatus>;
  getRFIs(projectId: string): Promise<RFI[]>;
  getSubmittals(projectId: string): Promise<Submittal[]>;
  getDailyLogs(projectId: string, dateRange: DateRange): Promise<DailyLog[]>;
  getBudgetSummary(projectId: string): Promise<BudgetSummary>;
  syncMilestones(projectId: string): Promise<Milestone[]>;
}
```

### Phase 4: Procore REST API v1
Do NOT use Procore Agent Builder or MCP endpoints yet — still beta, unstable surface.

---

## 10. CONTACTS / ROLODEX

The `parties` table is the global contact directory. No additional tables are needed — the schema already supports this fully.

### What the Contacts page shows per person:
- Name, company, title, email, phone, relationship_notes
- All projects they appear in (via `project_players`), with their role on each
- Latest update that mentioned them (via `updates.mentioned_parties` JSONB search)
- Latest email thread involving them (Phase 2+)
- DD items assigned to them
- Compliance items they're responsible for

### Route structure:
```
/contacts                  — global rolodex, all parties
/contacts/[id]             — individual contact detail page
```

### Contact detail page tabs:
1. **Overview** — bio info, relationship notes, contact details
2. **Projects** — every project they're linked to with role and status
3. **Activity** — all updates and documents where they're mentioned (searched from updates JSONB + activity_log)
4. **Notes** — freeform relationship notes, editable

### Key behaviors:
- Search/filter by name, company, role type
- "Add to Project" shortcut from the contact page
- Party records are global — editing a party's info updates it across all projects automatically
- Phase 2+: show email threads from Microsoft Graph where this contact is sender/recipient
- Parties can be flagged as `is_organization=true` to represent firms rather than individuals — show member contacts of the same company grouped together

### Build prompt location: Phase 1, Step 1.19A (added after seed data step)

---

## 11. DO NOT

- Add a separate vector database (pgvector is fine for years)
- Use Langchain, LlamaIndex, or any AI orchestration framework
- Build microservices (this is a monolith)
- Use Docker or containers
- Use Prisma or Drizzle (Supabase client + generated types)
- Pre-build features for future phases (stub interfaces, implement later)
- Use Opus for runtime AI calls
- Store CUI until GovCloud migration complete
- Poll Microsoft Graph API for email (use webhook subscriptions with renewal)

---

## 12. BUILD STATUS

**Phase:** 2 complete
**Current step:** query and synthesis
**Last completed:** 
**Next action:** 

### What's live as of 2026-05-01 (deployed to Vercel production)

| Route | Status |
|-------|--------|
| `/dashboard` | ✅ 3 projects, pipeline value, needs-attention panel |
| `/projects` | ✅ List with filters |
| `/projects/[id]` (Overview) | ✅ Project detail |
| `/projects/[id]/updates` | ✅ 5 updates on Fort Bragg, 3 on SLC, 2 on Rocky Mtn |
| `/projects/[id]/players` | ✅ 5–6 players per project |
| `/projects/[id]/milestones` | ✅ 6–8 milestones per project, completed/pending |
| `/projects/[id]/financing` | ✅ Capital stacks with draw schedules |
| `/projects/[id]/diligence` | ✅ DD items + compliance items |
| `/projects/[id]/documents` | ✅ Placeholder document records |
| `/projects/[id]/entities` | ✅ JV/entity structures |
| `/review` | ✅ 2 pending items (low-confidence + ambiguous project) |
| `/activity` | ✅ Full audit log from seed triggers |
| `/contacts` | ✅ 16 global parties |
| Manual Paste (PasteInput) | ✅ Extract → review → save flow wired to `/api/ai/extract` + `/api/updates/save` |

### Seed data summary

- **Fort Bragg Barracks:** Government, execution, $20.4M FFP — 5 updates with full extraction (action items, risks, decisions, waiting-on), 9 milestones (5 completed), Davis-Bacon + bonding compliance, 4 DD items
- **Salt Lake Mixed-Use:** Real estate, pursuit, $85M design-build — 3 updates, KEB PE partnership ($22M equity), Wells Fargo construction loan ($55M), height variance risk, Phase II environmental risk, JV entity structure (KEB 45% / BW 40% / Sorensen 15%)
- **Rocky Mountain Quantum:** Infrastructure, capture, $2.1B CMAR — 2 updates, RMIP/BW JV, Xcel power PSA blocker, zoning blocker, Mortenson teaming, complex entity structure

> UPDATE THIS SECTION at the end of every Claude Code session.
