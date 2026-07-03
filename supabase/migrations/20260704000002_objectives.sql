-- Objectives
-- The chief-of-staff steering board: a short list of company priorities sorted
-- into Now / Soon / Possibly buckets, drag-ordered within each bucket. One tiny
-- table — no pipeline, no scoring. Completed/parked objectives archive rather
-- than delete so the record of what got accomplished survives.
--
-- Bucket/status are plain text + app-level constants (src/lib/utils/objectives.ts)
-- rather than Postgres enums, so the set can evolve without a migration.

create table if not exists objectives (
  id uuid default gen_random_uuid() primary key,
  title text not null,                                -- headline, e.g. "Get IBM letter — secure Myton contracts"
  note text,                                          -- supporting detail ("$29k or $24k if the website waits…")
  bucket text not null default 'now',                 -- now | soon | possibly
  sort_order integer not null default 0,              -- position within the bucket (0 = top priority)
  owner_id uuid references team_members(id) on delete set null,
  target_date date,
  status text not null default 'active',              -- active | archived
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_objectives_bucket on objectives(bucket, sort_order);
create index if not exists idx_objectives_status on objectives(status);

-- updated_at trigger (reuses update_updated_at from 00006_triggers.sql)
-- NOTE: deliberately NOT attaching log_activity() — it dereferences
-- new.project_id, which this table doesn't have.
create trigger set_updated_at
  before update on objectives
  for each row execute function update_updated_at();

-- RLS — authenticated users get full access (app traffic uses the service
-- role; RLS is defense-in-depth, per CLAUDE.md §8)
alter table objectives enable row level security;
create policy "objectives_select" on objectives for select using (auth.role() = 'authenticated');
create policy "objectives_insert" on objectives for insert with check (auth.role() = 'authenticated');
create policy "objectives_update" on objectives for update using (auth.role() = 'authenticated');
create policy "objectives_delete" on objectives for delete using (auth.role() = 'authenticated');
