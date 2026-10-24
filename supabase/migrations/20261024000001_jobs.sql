-- ============================================================================
-- JOBS — the second assistant: open-ended work, as against Ber AI's questions
-- and Pepper's proactive notes.
--
-- Richard, 2026-10-24: "I want this separate part to really accomplish any task
-- I give it. Might be scrubbing through data or really any tasks that one might
-- want to task AI to do... an additional assistant to Pepper that isn't built
-- strictly around intelligence."
--
-- THE GATE IS MUTATION, NOT OPEN-ENDEDNESS. A job may READ and REASON without
-- limit — the output is a report, so a wrong one costs a re-read. What it may
-- CHANGE comes from a typed vocabulary applied on a human's press, because an
-- arbitrary write is the one output you cannot undo by reading it again. So:
-- `report` is free-form, `operations` is a checked list, and `applied_at` is a
-- separate moment from `finished_at`.
-- ============================================================================

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),

  created_by uuid not null references auth.users(id),
  instruction text not null,
  -- A short name for the list. Written by the model from the instruction, so a
  -- job is identifiable without reading a paragraph; a human may overwrite it.
  title text,

  status text not null default 'queued',

  -- ── The clock, because an in-progress status cannot settle itself ─────────
  -- A kickstart kills the runner before it can record either verdict, so
  -- `working` is immortal and every reader must pair it with a started-at
  -- (§12). `heartbeat_at` moves after every round, so a job that is genuinely
  -- long is distinguishable from one that died — a count that has stopped
  -- growing is indistinguishable from a quiet inbox.
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,

  -- ── What it found ─────────────────────────────────────────────────────────
  report text,
  -- Proposed writes, each one a member of the vocabulary in
  -- src/lib/jobs/operations.ts. Never SQL and never prose.
  operations jsonb not null default '[]'::jsonb,

  -- ── What was actually done, and by whom ───────────────────────────────────
  applied_at timestamptz,
  applied_by uuid references auth.users(id),
  applied_result jsonb,

  -- ── Files the job was given ───────────────────────────────────────────────
  attachments jsonb not null default '[]'::jsonb,

  -- ── Run accounting, matching the ai_queries contract ─────────────────────
  error text,
  rounds integer not null default 0,
  model text,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint jobs_status_check check (
    status in ('queued', 'working', 'review', 'applying', 'done', 'failed', 'cancelled')
  ),
  -- A finished job has a finish time and a started one has a start time; the
  -- pair is what makes the staleness test possible at all.
  constraint jobs_started_when_past_queued check (
    status = 'queued' or started_at is not null
  )
);

comment on column jobs.operations is
  'Proposed writes from the typed vocabulary in src/lib/jobs/operations.ts. The vocabulary IS the security boundary — never SQL, never free prose.';
comment on column jobs.heartbeat_at is
  'Moved after every tool round. Paired with status=working this is the liveness test; a count alone cannot tell a long job from a dead one.';

create index if not exists jobs_status_idx on jobs (status, queued_at);
create index if not exists jobs_created_by_idx on jobs (created_by, created_at desc);

-- ── The step log ────────────────────────────────────────────────────────────
-- Its own table rather than a jsonb column on `jobs`, so appending a step is an
-- insert instead of a rewrite of a growing blob on every round.
create table if not exists job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  seq integer not null,
  kind text not null,
  label text,
  detail jsonb,
  created_at timestamptz default now(),
  constraint job_events_kind_check check (kind in ('status', 'tool', 'note', 'error')),
  constraint job_events_seq_unique unique (job_id, seq)
);

create index if not exists job_events_job_idx on job_events (job_id, seq);

alter table jobs enable row level security;
alter table job_events enable row level security;

drop trigger if exists set_updated_at on jobs;
create trigger set_updated_at before update on jobs
  for each row execute function update_updated_at();
