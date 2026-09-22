-- Bid deadlines become tasks instead of calendar events.
--
-- The lead sweep wrote an all-day Google Calendar event for every pursue/
-- consider lead's bid date, site visit and RFI deadline, and nothing ever
-- deleted them. By 2026-09-21, 107 leads had events written and 100 of those
-- bid dates were already in the past, so the calendar read as noise while the
-- task board — which syncs to Google Tasks, and therefore renders in Calendar
-- discreetly — held six rows.

-- The forward link. ON DELETE SET NULL, not CASCADE: pruneSurplusLeads()
-- removes surplus leads after a re-triage, and it must never take a human's
-- task with it.
alter table tasks add column if not exists lead_id uuid
  references leads(id) on delete set null;

-- THE IDEMPOTENCY CONSTRAINT, and it is deliberately NOT partial.
--
-- `where lead_id is not null` is the instinct and it breaks the writer:
-- PostgREST emits `ON CONFLICT (lead_id)` with no WHERE clause, so Postgres
-- cannot infer a partial index and every upsert fails with "no unique or
-- exclusion constraint matching the ON CONFLICT specification" — the same trap
-- the leads(thread_id, thread_item) index hit on 2026-09-09.
--
-- A plain unique index is already correct here: Postgres treats NULLs as
-- DISTINCT by default, so the existing tasks with lead_id NULL coexist freely
-- and one lead can still hold at most one task.
create unique index if not exists idx_tasks_lead_id on tasks (lead_id);

-- The once-per-lead latch, the same device as notified_at / gmail_draft_id in
-- this module. Set the first time a task is written and NEVER cleared.
--
-- This is what makes a DELETED task stay deleted. The unique index alone
-- cannot: delete the task row and the index no longer blocks anything, so
-- tomorrow's sweep would insert it again. Deleting it WAS the decision — the
-- same argument gmail_draft_id makes about a draft a human threw away.
alter table leads add column if not exists task_id uuid
  references tasks(id) on delete set null;
alter table leads add column if not exists task_synced_at timestamptz;

-- The base value for the due-date merge: the bid date as we last wrote it.
--
-- Without it there is no way to tell "the bid date moved, push it" from "a
-- human moved the due date on their phone, leave it" — and the platform would
-- overwrite that edit every morning, forever. Exactly the role
-- task_google_links.base_due plays one layer down.
alter table leads add column if not exists task_bid_date date;

-- The sweep's hot path: which qualifying leads have no task yet.
create index if not exists idx_leads_task_sync
  on leads (status, score_state, bid_due_date)
  where task_synced_at is null;
