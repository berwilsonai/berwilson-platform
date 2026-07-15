-- Investor documentation requirements (lender checklists)
-- Lenders (and some investors) demand a documentation package before they'll
-- underwrite — articles of organization, EIN letter, budgets, KYC, proof of
-- funds, etc. Each investor carries their own checklist:
--   project_id null — a standing/template requirement (what this lender always
--                     asks for on every deal)
--   project_id set  — the checklist instance for a specific deal package
-- evidence_doc_id links a requirement to the platform document that satisfies
-- it (no new upload surface — files live in the existing documents table).
-- Category/status are plain text + app constants (src/lib/utils/investors.ts),
-- no Postgres enums, so the vocab can evolve without a migration.

create table if not exists investor_requirements (
  id uuid default gen_random_uuid() primary key,
  investor_id uuid references investors(id) on delete cascade not null,
  project_id uuid references projects(id) on delete set null,       -- null = standing/template requirement
  category text not null default 'project',           -- corporate | project | sponsor | other
  item text not null,
  status text not null default 'needed',              -- needed | in_progress | have | submitted | waived | n_a
  evidence_doc_id uuid references documents(id) on delete set null, -- the document that satisfies it
  notes text,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_investor_requirements_investor on investor_requirements(investor_id);
create index if not exists idx_investor_requirements_project on investor_requirements(project_id);

-- updated_at trigger only (reuses update_updated_at from 00006_triggers.sql).
-- NOTE: deliberately NOT attaching log_activity() — same reasoning as the
-- investors tables (it dereferences new.project_id unconditionally, and
-- project_id is nullable here).
create trigger set_updated_at
  before update on investor_requirements
  for each row execute function update_updated_at();

-- RLS — authenticated users get full access (app traffic uses the service
-- role; RLS is defense-in-depth, per CLAUDE.md §8)
alter table investor_requirements enable row level security;
create policy "investor_requirements_select" on investor_requirements for select using (auth.role() = 'authenticated');
create policy "investor_requirements_insert" on investor_requirements for insert with check (auth.role() = 'authenticated');
create policy "investor_requirements_update" on investor_requirements for update using (auth.role() = 'authenticated');
create policy "investor_requirements_delete" on investor_requirements for delete using (auth.role() = 'authenticated');
