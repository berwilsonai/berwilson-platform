-- Opportunities
-- A pipeline for non-project pursuits: acquisitions, partnerships, JVs, equity
-- investments, teaming, market entry, etc. Modeled like `projects` but lighter —
-- it tracks strategic intent (objective + thesis), what kind of opportunity it is,
-- progress through a deal pipeline, attached white papers, and a notes feed.
--
-- Type/status/sector are plain text + app-level constants (src/lib/utils/opportunities.ts)
-- rather than Postgres enums, so the set can evolve without a migration.

-- ============================================================
-- opportunities — master record
-- ============================================================
create table if not exists opportunities (
  id uuid default gen_random_uuid() primary key,
  name text not null,                                 -- headline, e.g. "Acquire Mountain Steel Fabricators"
  opp_type text not null default 'acquisition',       -- acquisition | partnership | joint_venture | investment | merger | divestiture | teaming | market_entry | other
  status text not null default 'identified',          -- identified | evaluating | in_discussion | due_diligence | negotiating | agreement | closed_won | closed_passed
  priority text default 'medium',                     -- low | medium | high

  description text,                                   -- what it is, in plain language
  objective text,                                     -- what Ber Wilson wants to achieve
  thesis text,                                        -- strategic rationale / why it fits

  target_name text,                                   -- the company / asset / counterparty under consideration
  counterparty text,                                  -- who we're negotiating with (if different)
  sector text,                                        -- reuses project sectors: government | infrastructure | real_estate | prefab | institutional
  location text,
  website text,
  source text,                                        -- how it came to us (inbound, banker, referral, outbound…)

  estimated_value numeric(15,2),                      -- deal size / enterprise value
  deal_structure text,                                -- asset purchase, stock purchase, equity stake, earnout…
  ownership_stake numeric(5,2),                       -- % we'd hold / acquire
  probability integer,                                -- 0–100 likelihood of closing
  lead text,                                           -- internal owner of the pursuit

  identified_date date,
  target_close_date date,
  next_step text,                                     -- the single next action

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_opportunities_status on opportunities(status);
create index if not exists idx_opportunities_type on opportunities(opp_type);
create index if not exists idx_opportunities_updated on opportunities(updated_at desc);

-- ============================================================
-- opportunity_documents — white papers / teasers / CIMs / decks
-- (kept separate from `documents` so it doesn't touch the RAG/chunks pipeline)
-- ============================================================
create table if not exists opportunity_documents (
  id uuid default gen_random_uuid() primary key,
  opportunity_id uuid references opportunities(id) on delete cascade not null,
  storage_path text not null,
  file_name text not null,
  file_size_bytes bigint,
  mime_type text,
  doc_type text default 'white_paper',                -- white_paper | teaser | cim | financials | deck | memo | other
  ai_summary text,
  uploaded_at timestamptz default now()
);

create index if not exists idx_opportunity_documents_opp on opportunity_documents(opportunity_id);

-- ============================================================
-- opportunity_notes — progress feed
-- ============================================================
create table if not exists opportunity_notes (
  id uuid default gen_random_uuid() primary key,
  opportunity_id uuid references opportunities(id) on delete cascade not null,
  body text not null,
  author text,
  created_at timestamptz default now()
);

create index if not exists idx_opportunity_notes_opp on opportunity_notes(opportunity_id);

-- ============================================================
-- updated_at trigger (reuses update_updated_at from 00006_triggers.sql)
-- NOTE: deliberately NOT attaching log_activity() — it dereferences
-- new.project_id, which this table doesn't have.
-- ============================================================
create trigger set_updated_at
  before update on opportunities
  for each row execute function update_updated_at();

-- ============================================================
-- RLS — authenticated users get full access (app traffic uses the service
-- role; RLS is defense-in-depth, per CLAUDE.md §8)
-- ============================================================
alter table opportunities enable row level security;
create policy "opportunities_select" on opportunities for select using (auth.role() = 'authenticated');
create policy "opportunities_insert" on opportunities for insert with check (auth.role() = 'authenticated');
create policy "opportunities_update" on opportunities for update using (auth.role() = 'authenticated');
create policy "opportunities_delete" on opportunities for delete using (auth.role() = 'authenticated');

alter table opportunity_documents enable row level security;
create policy "opportunity_documents_select" on opportunity_documents for select using (auth.role() = 'authenticated');
create policy "opportunity_documents_insert" on opportunity_documents for insert with check (auth.role() = 'authenticated');
create policy "opportunity_documents_update" on opportunity_documents for update using (auth.role() = 'authenticated');
create policy "opportunity_documents_delete" on opportunity_documents for delete using (auth.role() = 'authenticated');

alter table opportunity_notes enable row level security;
create policy "opportunity_notes_select" on opportunity_notes for select using (auth.role() = 'authenticated');
create policy "opportunity_notes_insert" on opportunity_notes for insert with check (auth.role() = 'authenticated');
create policy "opportunity_notes_update" on opportunity_notes for update using (auth.role() = 'authenticated');
create policy "opportunity_notes_delete" on opportunity_notes for delete using (auth.role() = 'authenticated');
