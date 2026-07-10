-- Raises — named capital raises with a tranche schedule
--
-- A raise is the container an $88M round lives in: a target amount, a status,
-- and a tranche schedule ($25M / $25M / $25M / $13M). Investments tag a raise
-- via investments.raise_id so "potential vs actual per raise" is computable:
-- indicated = potential, committed/funded = actual, summed over the raise's
-- investments.
--
-- Tranches are TARGETS, not ledger rows (Richard's call 2026-07-10): investors
-- commit to the raise, and the dashboard fills tranches sequentially from the
-- raise's committed/funded totals (waterfall fill). They live as a jsonb array
-- [{label, amount, target_date}] on the raise — pure schedule config, no FK
-- needs. If per-tranche investor earmarking is ever needed, add a tranche tag
-- on investments then.
--
-- Status is plain text + app constants (src/lib/utils/investors.ts), no enum.

create table if not exists raises (
  id uuid default gen_random_uuid() primary key,
  name text not null,                                 -- "Raise 1 — Parent Co ($88M)"
  target_kind text not null default 'company',        -- company (parent Ber Wilson) | project
  project_id uuid references projects(id) on delete cascade,  -- required when target_kind = 'project'
  target_amount numeric(15,2),                        -- the headline goal
  status text not null default 'open',                -- planned | open | closed
  tranches jsonb not null default '[]'::jsonb,        -- [{label, amount, target_date}] — schedule, not ledger
  open_date date,
  target_close_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint raises_target_check check (
    (target_kind = 'project' and project_id is not null)
    or (target_kind = 'company' and project_id is null)
  )
);

create index if not exists idx_raises_status on raises(status);
create index if not exists idx_raises_project on raises(project_id);

-- Investments tag the raise they belong to. Nullable — pre-raise commitments
-- and project-direct deals stay valid; deleting a raise unlinks, never deletes
-- the money records.
alter table investments add column if not exists raise_id uuid references raises(id) on delete set null;
create index if not exists idx_investments_raise on investments(raise_id);

-- updated_at trigger (reuses update_updated_at from 00006_triggers.sql).
-- Deliberately NOT attaching log_activity() — same reasoning as investors.
create trigger set_updated_at
  before update on raises
  for each row execute function update_updated_at();

-- RLS — authenticated users get full access (app traffic uses the service
-- role; RLS is defense-in-depth, per CLAUDE.md §8)
alter table raises enable row level security;
create policy "raises_select" on raises for select using (auth.role() = 'authenticated');
create policy "raises_insert" on raises for insert with check (auth.role() = 'authenticated');
create policy "raises_update" on raises for update using (auth.role() = 'authenticated');
create policy "raises_delete" on raises for delete using (auth.role() = 'authenticated');
