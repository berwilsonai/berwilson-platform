-- dd_items.status: NOT NULL, matching what every reader already assumes.
--
-- Five separate surfaces filter open diligence with `.neq('status','resolved')`
-- — the dashboard badge, /api/attention, the weekly brief, risk scoring and
-- meeting prep. PostgREST renders that as SQL `status <> 'resolved'`, which is
-- NULL (and therefore not-true) for a NULL status, so a row with no status set
-- is silently dropped from all five. For a critical/blocker diligence item that
-- is the worst possible failure: it exists, and nothing that is supposed to
-- raise it can see it.
--
-- The column already carries `default 'open'` and every writer in the app sets
-- it explicitly, so this enforces the existing intent rather than changing
-- behaviour. Backfill first so the constraint cannot fail on legacy rows
-- written before the default existed.
update public.dd_items set status = 'open' where status is null;
alter table public.dd_items alter column status set not null;
