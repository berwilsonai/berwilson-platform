-- 00003_core_tables.sql
-- All core application tables

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
