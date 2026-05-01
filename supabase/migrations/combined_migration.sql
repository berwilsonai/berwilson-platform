-- ============================================================
-- BER WILSON — Executive Intelligence Platform
-- Combined Migration Runner
-- Paste this entire file into the Supabase SQL Editor and run.
-- Idempotent for extensions; all other objects must not exist yet.
-- ============================================================


-- ============================================================
-- 00001 · EXTENSIONS
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists vector;


-- ============================================================
-- 00002 · ENUMS
-- ============================================================

create type project_sector as enum ('government','infrastructure','real_estate','prefab','institutional');
create type project_status as enum ('active','on_hold','won','lost','closed');
create type project_stage as enum ('pursuit','capture','bid','award','mobilization','execution','closeout');
create type update_source as enum ('email','manual_paste','document','agent','procore');
create type review_state as enum ('pending','approved','rejected');
create type dd_severity as enum ('info','watch','critical','blocker');
create type compliance_status as enum ('not_started','in_progress','compliant','non_compliant','waived');
create type entity_type as enum ('llc','corp','jv','subsidiary','trust','fund','other');


-- ============================================================
-- 00003 · CORE TABLES
-- ============================================================

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


-- ============================================================
-- 00004 · INDEXES
-- ============================================================

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


-- ============================================================
-- 00005 · RLS POLICIES
-- ============================================================

-- parties
alter table parties enable row level security;
create policy "parties_select" on parties for select using (auth.role() = 'authenticated');
create policy "parties_insert" on parties for insert with check (auth.role() = 'authenticated');
create policy "parties_update" on parties for update using (auth.role() = 'authenticated');
create policy "parties_delete" on parties for delete using (auth.role() = 'authenticated');

-- entities
alter table entities enable row level security;
create policy "entities_select" on entities for select using (auth.role() = 'authenticated');
create policy "entities_insert" on entities for insert with check (auth.role() = 'authenticated');
create policy "entities_update" on entities for update using (auth.role() = 'authenticated');
create policy "entities_delete" on entities for delete using (auth.role() = 'authenticated');

-- projects
alter table projects enable row level security;
create policy "projects_select" on projects for select using (auth.role() = 'authenticated');
create policy "projects_insert" on projects for insert with check (auth.role() = 'authenticated');
create policy "projects_update" on projects for update using (auth.role() = 'authenticated');
create policy "projects_delete" on projects for delete using (auth.role() = 'authenticated');

-- project_players
alter table project_players enable row level security;
create policy "project_players_select" on project_players for select using (auth.role() = 'authenticated');
create policy "project_players_insert" on project_players for insert with check (auth.role() = 'authenticated');
create policy "project_players_update" on project_players for update using (auth.role() = 'authenticated');
create policy "project_players_delete" on project_players for delete using (auth.role() = 'authenticated');

-- milestones
alter table milestones enable row level security;
create policy "milestones_select" on milestones for select using (auth.role() = 'authenticated');
create policy "milestones_insert" on milestones for insert with check (auth.role() = 'authenticated');
create policy "milestones_update" on milestones for update using (auth.role() = 'authenticated');
create policy "milestones_delete" on milestones for delete using (auth.role() = 'authenticated');

-- documents
alter table documents enable row level security;
create policy "documents_select" on documents for select using (auth.role() = 'authenticated');
create policy "documents_insert" on documents for insert with check (auth.role() = 'authenticated');
create policy "documents_update" on documents for update using (auth.role() = 'authenticated');
create policy "documents_delete" on documents for delete using (auth.role() = 'authenticated');

-- updates
alter table updates enable row level security;
create policy "updates_select" on updates for select using (auth.role() = 'authenticated');
create policy "updates_insert" on updates for insert with check (auth.role() = 'authenticated');
create policy "updates_update" on updates for update using (auth.role() = 'authenticated');
create policy "updates_delete" on updates for delete using (auth.role() = 'authenticated');

-- chunks
alter table chunks enable row level security;
create policy "chunks_select" on chunks for select using (auth.role() = 'authenticated');
create policy "chunks_insert" on chunks for insert with check (auth.role() = 'authenticated');
create policy "chunks_update" on chunks for update using (auth.role() = 'authenticated');
create policy "chunks_delete" on chunks for delete using (auth.role() = 'authenticated');

-- dd_items
alter table dd_items enable row level security;
create policy "dd_items_select" on dd_items for select using (auth.role() = 'authenticated');
create policy "dd_items_insert" on dd_items for insert with check (auth.role() = 'authenticated');
create policy "dd_items_update" on dd_items for update using (auth.role() = 'authenticated');
create policy "dd_items_delete" on dd_items for delete using (auth.role() = 'authenticated');

-- financing_structures
alter table financing_structures enable row level security;
create policy "financing_structures_select" on financing_structures for select using (auth.role() = 'authenticated');
create policy "financing_structures_insert" on financing_structures for insert with check (auth.role() = 'authenticated');
create policy "financing_structures_update" on financing_structures for update using (auth.role() = 'authenticated');
create policy "financing_structures_delete" on financing_structures for delete using (auth.role() = 'authenticated');

-- compliance_items
alter table compliance_items enable row level security;
create policy "compliance_items_select" on compliance_items for select using (auth.role() = 'authenticated');
create policy "compliance_items_insert" on compliance_items for insert with check (auth.role() = 'authenticated');
create policy "compliance_items_update" on compliance_items for update using (auth.role() = 'authenticated');
create policy "compliance_items_delete" on compliance_items for delete using (auth.role() = 'authenticated');

-- entity_projects
alter table entity_projects enable row level security;
create policy "entity_projects_select" on entity_projects for select using (auth.role() = 'authenticated');
create policy "entity_projects_insert" on entity_projects for insert with check (auth.role() = 'authenticated');
create policy "entity_projects_update" on entity_projects for update using (auth.role() = 'authenticated');
create policy "entity_projects_delete" on entity_projects for delete using (auth.role() = 'authenticated');

-- activity_log — APPEND-ONLY: select + insert only, no update or delete ever
alter table activity_log enable row level security;
create policy "activity_log_select" on activity_log for select using (auth.role() = 'authenticated');
create policy "activity_log_insert" on activity_log for insert with check (auth.role() = 'authenticated');

-- review_queue
alter table review_queue enable row level security;
create policy "review_queue_select" on review_queue for select using (auth.role() = 'authenticated');
create policy "review_queue_insert" on review_queue for insert with check (auth.role() = 'authenticated');
create policy "review_queue_update" on review_queue for update using (auth.role() = 'authenticated');
create policy "review_queue_delete" on review_queue for delete using (auth.role() = 'authenticated');

-- ai_queries
alter table ai_queries enable row level security;
create policy "ai_queries_select" on ai_queries for select using (auth.role() = 'authenticated');
create policy "ai_queries_insert" on ai_queries for insert with check (auth.role() = 'authenticated');
create policy "ai_queries_update" on ai_queries for update using (auth.role() = 'authenticated');
create policy "ai_queries_delete" on ai_queries for delete using (auth.role() = 'authenticated');

-- research_artifacts
alter table research_artifacts enable row level security;
create policy "research_artifacts_select" on research_artifacts for select using (auth.role() = 'authenticated');
create policy "research_artifacts_insert" on research_artifacts for insert with check (auth.role() = 'authenticated');
create policy "research_artifacts_update" on research_artifacts for update using (auth.role() = 'authenticated');
create policy "research_artifacts_delete" on research_artifacts for delete using (auth.role() = 'authenticated');


-- ============================================================
-- 00006 · TRIGGERS
-- ============================================================

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at
  before update on parties
  for each row execute function update_updated_at();

create trigger set_updated_at
  before update on projects
  for each row execute function update_updated_at();

create trigger set_updated_at
  before update on financing_structures
  for each row execute function update_updated_at();

create trigger set_updated_at
  before update on compliance_items
  for each row execute function update_updated_at();

-- Auto-insert activity_log
create or replace function log_activity()
returns trigger as $$
begin
  insert into activity_log (actor_id, actor_type, action, table_name, record_id, project_id, metadata)
  values (
    auth.uid(),
    'user',
    TG_OP,
    TG_TABLE_NAME,
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

create trigger log_projects
  after insert or update or delete on projects
  for each row execute function log_activity();

create trigger log_updates
  after insert or update or delete on updates
  for each row execute function log_activity();

create trigger log_documents
  after insert or update or delete on documents
  for each row execute function log_activity();

create trigger log_milestones
  after insert or update or delete on milestones
  for each row execute function log_activity();

create trigger log_dd_items
  after insert or update or delete on dd_items
  for each row execute function log_activity();

create trigger log_review
  after insert or update or delete on review_queue
  for each row execute function log_activity();

create trigger log_financing
  after insert or update or delete on financing_structures
  for each row execute function log_activity();

create trigger log_compliance
  after insert or update or delete on compliance_items
  for each row execute function log_activity();
