-- Proposal intake sessions: stores intermediate state between AI extraction and user confirmation
-- Enables a two-step flow: extract → review → confirm

create extension if not exists pg_trgm;

-- Trigram indexes for fuzzy matching
create index if not exists idx_projects_name_trgm on projects using gin (name gin_trgm_ops);
create index if not exists idx_parties_name_trgm on parties using gin (full_name gin_trgm_ops);

create table proposal_intake_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  status text not null default 'pending',  -- pending, confirmed, cancelled, expired
  extraction_result jsonb not null,
  match_candidates jsonb default '[]',
  uploaded_files jsonb not null,           -- [{temp_path, file_name, file_size_bytes, mime_type, is_primary}]
  confirmed_action text,                   -- create_new, link_to_existing, add_to_existing
  confirmed_project_id uuid references projects(id),
  created_at timestamptz default now(),
  confirmed_at timestamptz,
  expires_at timestamptz default now() + interval '24 hours'
);

create index idx_intake_sessions_user on proposal_intake_sessions(user_id, status);
create index idx_intake_sessions_expires on proposal_intake_sessions(expires_at) where status = 'pending';

alter table proposal_intake_sessions enable row level security;
create policy "intake_select" on proposal_intake_sessions for select using (auth.role() = 'authenticated');
create policy "intake_insert" on proposal_intake_sessions for insert with check (auth.role() = 'authenticated');
create policy "intake_update" on proposal_intake_sessions for update using (auth.role() = 'authenticated');

-- RPC functions for trigram matching
create or replace function match_projects_by_name(search_name text, threshold float default 0.3)
returns table(id uuid, name text, similarity float) as $$
  select p.id, p.name, similarity(p.name, search_name)::float as similarity
  from projects p
  where similarity(p.name, search_name) > threshold
  order by similarity desc
  limit 5;
$$ language sql stable;

create or replace function match_parties_by_name(search_name text, threshold float default 0.4)
returns table(id uuid, full_name text, similarity float) as $$
  select p.id, p.full_name, similarity(p.full_name, search_name)::float as similarity
  from parties p
  where similarity(p.full_name, search_name) > threshold
  order by similarity desc
  limit 5;
$$ language sql stable;
