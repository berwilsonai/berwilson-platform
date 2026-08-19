-- Dino Service Pros — internal operating company revenue tracker
-- (see CLAUDE.md). Dino is an acquired plumbing/HVAC company, one of our OWN
-- operating companies — not a vendor, not a project. The executive goal is to
-- track its revenue split by SOURCE (internal = Ber Wilson work vs external =
-- Dino's existing clients) so we can show Dino its business is increasingly
-- coming from Ber Wilson, plus track the $150k we owe them over 12 months.
--
-- Dino-specific for now (not a generic operating-companies framework). Cloned
-- shape from the investors module (money records + rollup + admin-only). Plain
-- text vocab + app constants (src/lib/utils/dino.ts), no Postgres enums.

-- ============================================================
-- dino_revenue — the revenue ledger
--   source_type internal  → linked to a Ber Wilson project (project_id)
--   source_type external  → Dino's own client (client_name); a row can be a
--                           single job OR a periodic lump ("Q1 2026 — existing
--                           clients") — one table covers both.
-- ============================================================
create table if not exists dino_revenue (
  id uuid default gen_random_uuid() primary key,
  source_type text not null default 'internal',              -- internal | external
  project_id uuid references projects(id) on delete set null, -- the Ber Wilson project (internal jobs)
  client_name text,                                          -- the external client (external jobs)
  description text,
  amount numeric(15,2) not null default 0,
  revenue_date date not null,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint dino_revenue_source_check check (source_type in ('internal', 'external'))
);

create index if not exists idx_dino_revenue_date on dino_revenue(revenue_date desc);
create index if not exists idx_dino_revenue_source on dino_revenue(source_type);
create index if not exists idx_dino_revenue_project on dino_revenue(project_id);

-- ============================================================
-- dino_payments — the $150k / 12-month obligation schedule (money we owe Dino)
-- ============================================================
create table if not exists dino_payments (
  id uuid default gen_random_uuid() primary key,
  label text,
  amount numeric(15,2) not null default 0,
  due_date date,
  paid boolean not null default false,
  paid_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_dino_payments_due on dino_payments(due_date);

-- ============================================================
-- dino_notes — running relationship log
-- ============================================================
create table if not exists dino_notes (
  id uuid default gen_random_uuid() primary key,
  body text not null,
  author text,
  created_at timestamptz default now()
);

create index if not exists idx_dino_notes_created on dino_notes(created_at desc);

-- ============================================================
-- updated_at triggers (reuses update_updated_at from 00006_triggers.sql)
-- NOTE: deliberately NOT attaching log_activity() — same reasoning as
-- investors/opportunities (it dereferences new.project_id unconditionally).
-- ============================================================
create trigger set_updated_at
  before update on dino_revenue
  for each row execute function update_updated_at();

create trigger set_updated_at
  before update on dino_payments
  for each row execute function update_updated_at();

-- ============================================================
-- RLS — authenticated users get full access (app traffic uses the service
-- role; RLS is defense-in-depth, per CLAUDE.md §8). The real boundary is the
-- middleware: /dino + /api/dino are admin-only by default-deny.
-- ============================================================
alter table dino_revenue enable row level security;
create policy "dino_revenue_select" on dino_revenue for select using (auth.role() = 'authenticated');
create policy "dino_revenue_insert" on dino_revenue for insert with check (auth.role() = 'authenticated');
create policy "dino_revenue_update" on dino_revenue for update using (auth.role() = 'authenticated');
create policy "dino_revenue_delete" on dino_revenue for delete using (auth.role() = 'authenticated');

alter table dino_payments enable row level security;
create policy "dino_payments_select" on dino_payments for select using (auth.role() = 'authenticated');
create policy "dino_payments_insert" on dino_payments for insert with check (auth.role() = 'authenticated');
create policy "dino_payments_update" on dino_payments for update using (auth.role() = 'authenticated');
create policy "dino_payments_delete" on dino_payments for delete using (auth.role() = 'authenticated');

alter table dino_notes enable row level security;
create policy "dino_notes_select" on dino_notes for select using (auth.role() = 'authenticated');
create policy "dino_notes_insert" on dino_notes for insert with check (auth.role() = 'authenticated');
create policy "dino_notes_update" on dino_notes for update using (auth.role() = 'authenticated');
create policy "dino_notes_delete" on dino_notes for delete using (auth.role() = 'authenticated');
