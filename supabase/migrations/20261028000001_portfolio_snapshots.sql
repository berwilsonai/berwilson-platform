-- portfolio_snapshots — one row a week, so a KPI tile can say which way it is going.
--
-- ⚠ WHY A TABLE AND NOT A COMPUTATION. `StatTile` has carried a `trend` prop
-- and an inline `Sparkline` since 10-27 and has never drawn one, because
-- nothing in this platform remembers what a figure was last month. Every
-- number on /dashboard is computed live from the current rows; the history
-- does not exist anywhere to be derived from. That is a schema gap, not a UI
-- one, which is why the audit recorded a delta line as "not built" rather than
-- building it.
--
-- ⚠ CONFIDENTIAL PROJECTS ARE EXCLUDED BY THE WRITER, NOT BY A READER. §8:
-- `confidential` is containment, and a weekly portfolio figure is exactly the
-- aggregate it must stay out of. The writer uses the same
-- `dropHidden`/pipeline path every other aggregate uses, so a protected
-- project never reaches a row here — and because the row is a stored total,
-- there would be no way to filter it out afterwards.
--
-- ⚠ `captured_on` IS A DATE AND IS UNIQUE. A cron that fires twice (a deploy,
-- a manual run, a launchd catch-up after the box was asleep) must not write
-- two rows for one day and double the week. Upsert on the date.
create table if not exists portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_on date not null unique,
  pipeline_value numeric,
  weighted_pipeline_value numeric,
  active_projects integer,
  open_commitments integer,
  overdue_tasks integer,
  created_at timestamptz not null default now()
);

comment on table portfolio_snapshots is
  'One row per capture date of the dashboard KPI figures, so a tile can show a delta. Confidential projects are excluded at write time (§8) — the totals here are already aggregated and cannot be filtered afterwards.';

create index if not exists portfolio_snapshots_captured_on_idx
  on portfolio_snapshots (captured_on desc);

alter table portfolio_snapshots enable row level security;

-- Defence in depth; app traffic uses the service role (§8).
drop policy if exists portfolio_snapshots_read on portfolio_snapshots;
create policy portfolio_snapshots_read on portfolio_snapshots
  for select to authenticated using (true);

grant select on portfolio_snapshots to authenticated;
grant all on portfolio_snapshots to service_role;
