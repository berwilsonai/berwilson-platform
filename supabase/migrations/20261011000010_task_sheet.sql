-- The task board syncs to a Google SHEET, not to Google Tasks.
--
-- WHY THE CHANGE (Richard, 2026-10-11)
--
-- Google Tasks lists are private per account: no shared list, no assignee
-- field, no delegation. The 2026-09-10 sync therefore pushed each person their
-- own slice and `/tasks` stayed the only place the whole board existed — which
-- is the one view two executives steering a pipeline need to look at together.
-- A sheet is the whole board, on a phone, off the tailnet, for anyone with the
-- link. One file, a tab per person, and a checkbox that settles the task here.
--
-- ---------------------------------------------------------------------------
-- 1. task_sheet_state — where the workbook is remembered
-- ---------------------------------------------------------------------------
--
-- WHY A TABLE AND NOT AN ENV VAR: the spreadsheet id is CREATED by the platform
-- on first run, not configured by a human. Putting it in .env.local would mean
-- the first run writes a value nobody can persist, and the second run makes a
-- second workbook.
--
-- ONE ROW, ENFORCED BY THE SCHEMA. `id boolean primary key default true check
-- (id)` admits exactly one row: the PK blocks a second `true` and the CHECK
-- blocks `false`. A nullable singleton that silently grows to two rows would
-- have `maybeSingle()` start throwing, which reads as a database fault rather
-- than as what it is.
create table if not exists task_sheet_state (
  id boolean primary key default true check (id),

  -- The workbook. Verified to still exist on every run rather than trusted —
  -- a hand-trashed file is invisible from here otherwise, and every run would
  -- then write into something nobody can open while reporting success.
  spreadsheet_id text not null,
  spreadsheet_url text,

  -- Read by the health probe. A coverage count is the only honest signal for a
  -- feature whose failure mode is doing nothing, and a count that has stopped
  -- growing is indistinguishable from a quiet board — so the probe measures the
  -- AGE of this timestamp (§12, 09-20).
  last_synced_at timestamptz,
  last_error text,
  rows_published integer not null default 0,

  -- Cumulative, across all runs. The Google Tasks loop was reported green for
  -- sixteen days on the strength of its producing half while nothing had ever
  -- been settled by a human (§12, 10-09); this is the output side, so the
  -- failure is visible instead of being reported as health.
  settled_total integer not null default 0,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table task_sheet_state is
  'Single row. Where the Ber Wilson Tasks workbook lives and how the last sync '
  'went. NOT audited: src/lib/tasks/sheet.ts writes it every 15 minutes, and '
  'activity_log has no DELETE policy, ever.';

-- ⚠ DELIBERATELY NO log_activity TRIGGER, and no set_updated_at either.
-- This is sync bookkeeping written four times an hour. activity_log is
-- append-only by design with no delete policy (§4), so a trigger here is
-- thousands of unremovable junk audit rows a week — the same reason the Google
-- Tasks sync used a side table rather than columns on `tasks`, and the same
-- reason economics_versions and commitments carry no trigger.

-- ---------------------------------------------------------------------------
-- 2. Retire the Google Tasks sync tables — RENAMED, NOT DROPPED
-- ---------------------------------------------------------------------------
--
-- ⚠ THESE 39 LINK ROWS ARE THE ONLY RECORD OF WHAT IS SITTING IN RICHARD'S AND
-- ERIC'S GOOGLE TASKS LISTS. Dropping them strands every pushed task in two
-- personal to-do lists that will never update again, with nothing left that
-- knows which remote ids were ours — and a frozen to-do list does not look
-- frozen, it looks like a list (§12: an orphaned projection looks perfectly
-- live). Kept so scripts/retire-google-tasks.mts can clear them out.
--
-- Rename rather than keep in place so nothing can read them by their old names
-- by accident, following the `_bw_task_backfill_20260926` precedent.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'task_google_links') then
    execute 'alter table public.task_google_links rename to _bw_dropped_task_google_links_20261011';
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'google_task_lists') then
    execute 'alter table public.google_task_lists rename to _bw_dropped_google_task_lists_20261011';
  end if;
end $$;

comment on table _bw_dropped_task_google_links_20261011 is
  'Retired 2026-10-11 with the Google Tasks sync. Kept because it is the only '
  'map from a platform task to the copy sitting in a member''s Google list; '
  'scripts/retire-google-tasks.mts reads it to clear those out. Safe to drop '
  'once that has been run.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- ⚠ EXPLICIT, NOT INHERITED. A table created by a migration applied as anything
-- but `postgres` receives no API grants at all and every PostgREST call answers
-- 42501 (§12, 09-24). Stated here so the outcome does not depend on who ran it.
alter table public.task_sheet_state owner to postgres;
grant all on table public.task_sheet_state to anon, authenticated, service_role;

alter table task_sheet_state enable row level security;

-- RLS is defense-in-depth here; app traffic is service-role (§8).
drop policy if exists "task_sheet_state_all" on task_sheet_state;
create policy "task_sheet_state_all" on task_sheet_state
  for all using (auth.role() = 'authenticated');
