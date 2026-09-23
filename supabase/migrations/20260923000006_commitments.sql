-- Commitments + the daily digest.
--
-- WHY A COMMITMENT LEDGER EXISTS AT ALL.
-- Measured 2026-09-23 before building: BI holds almost no dated work. Zero
-- milestones with a future date, zero projects with a bid due date, nine open
-- tasks carrying a due date of which one is overdue. A reminder engine built on
-- that data would be silent, which is worse than absent — it teaches you the
-- platform has nothing to say.
--
-- The deadlines are real; they live in correspondence. The sweep already
-- extracts them as `open_items` on every thread summary ("Mike Ostermiller to
-- sign NDA", "Attend Friday 1:00 PM EST meeting") and NOTHING has ever read
-- them. This table is the reader: it gives those items an owner, a date, and a
-- settled/unsettled state, so the assistant has something to remind from.
--
-- DELIBERATELY NOT A ROW IN `tasks`. Same argument the dev_notes migration made
-- on 2026-09-23: `tasks` is the company's WORK board — assigned to team members,
-- tagged to projects/opportunities/objectives, and rolled into the weekly
-- report, the daily brief, /decide and the per-person workload chips. A
-- commitment is a MACHINE READING of an email, not agreed work. Putting model
-- output there would distort every one of those surfaces, and it would breach
-- the standing rule (CLAUDE.md §11) that mail never creates a task without a
-- human. Promoting a commitment into a real task stays one click.

create table if not exists commitments (
  id uuid primary key default gen_random_uuid(),

  -- Provenance. A commitment with no traceable source is an assertion nobody
  -- can check, so the thread is required and cascades: delete the conversation
  -- and its readings go with it.
  thread_id uuid not null references email_threads(id) on delete cascade,

  -- Stable identity WITHIN a thread, so re-extraction after the conversation
  -- grows updates a commitment in place instead of stacking a near-duplicate
  -- beside it. Derived from the normalized commitment text — see
  -- src/lib/commitments/extract-phase.ts, which owns the derivation.
  item_key text not null,

  -- What was promised, in the correspondence's own terms.
  what text not null,

  -- WHICH SIDE OWES IT. This is the whole point of the ledger: "we owe them the
  -- pricing" and "they owe us the signed NDA" demand opposite actions, and a
  -- flat to-do list cannot tell them apart.
  side text not null check (side in ('us', 'them')),
  owner_name text,

  -- Nullable by design. Most commitments in real mail carry no date; inventing
  -- one to make the column non-null would manufacture deadlines that were never
  -- agreed, which is the failure this whole feature exists to avoid.
  due_date date,

  -- open      — still outstanding as of the last reading of the thread
  -- resolved  — the model no longer sees it in the thread (auto)
  -- done      — a HUMAN settled it
  -- dismissed — a HUMAN rejected it (a bad read, or not ours)
  --
  -- The split between `resolved` and `done` is load-bearing: one is the machine
  -- changing its mind, the other is a person's decision. Re-extraction may
  -- freely move a row in and out of `resolved`; it must NEVER overwrite `done`
  -- or `dismissed`, or a human's judgement would be silently undone every hour.
  status text not null default 'open' check (status in ('open', 'resolved', 'done', 'dismissed')),

  confidence numeric,

  -- Optional record scope, copied from the thread's own link at extraction
  -- time. Nullable both ways: most mail is not filed to a record yet, and a
  -- commitment is still worth tracking before it is.
  project_id uuid references projects(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete set null,

  settled_at timestamptz,
  settled_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),

  -- One row per reading per thread. This is what makes re-extraction an upsert
  -- rather than an ever-growing pile.
  unique (thread_id, item_key)
);

-- The ledger's only hot query: what is outstanding, soonest first. Partial, so
-- the index stays small as settled rows accumulate — they are kept for the
-- audit trail but never scanned by the dashboard.
create index if not exists idx_commitments_open
  on commitments (side, due_date nulls last, created_at desc)
  where status = 'open';

create index if not exists idx_commitments_thread on commitments (thread_id);
create index if not exists idx_commitments_project on commitments (project_id) where project_id is not null;
create index if not exists idx_commitments_opportunity on commitments (opportunity_id) where opportunity_id is not null;

drop trigger if exists set_updated_at on commitments;
create trigger set_updated_at before update on commitments
  for each row execute function update_updated_at();

-- No log_activity() trigger. It is attachable now (verified 2026-09-23 — the
-- current function reads project_id through to_jsonb, so a project-less table
-- logs cleanly), but a commitment is refreshed by a machine every time its
-- thread grows: attaching it would write audit rows for model churn and bury
-- the human actions the log exists to record. The human half — settling a
-- commitment — is recorded on the row itself via settled_at/settled_by.

alter table commitments enable row level security;

drop policy if exists "Authenticated users can read commitments" on commitments;
create policy "Authenticated users can read commitments" on commitments
  for select to authenticated using (true);

drop policy if exists "Authenticated users can write commitments" on commitments;
create policy "Authenticated users can write commitments" on commitments
  for all to authenticated using (true) with check (true);

-- Re-extraction marker. Mirrors routed_at / embedded_at exactly: cleared
-- wherever a thread is marked as having grown, so a conversation that gains a
-- reply is re-read rather than leaving the ledger asserting a commitment the
-- latest message already settled.
alter table email_threads add column if not exists commitments_at timestamptz;

create index if not exists idx_threads_commitments_pending
  on email_threads (last_at desc)
  where commitments_at is null;

-- The daily digest is a stored brief, and brief_type carries a CHECK. Adding a
-- discriminator value without widening it fails at INSERT, not at compile time
-- — exactly what happened on 2026-09-19 when stored_briefs.opportunity_id was
-- added: it typechecked, deployed, and then every insert failed against this
-- same constraint while the API logged it and returned the brief anyway, so the
-- only symptom was a page that stayed empty.
alter table stored_briefs drop constraint if exists stored_briefs_brief_type_check;
alter table stored_briefs add constraint stored_briefs_brief_type_check
  check (brief_type in ('portfolio', 'project', 'meeting_prep', 'opportunity', 'daily_digest'));
