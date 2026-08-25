-- Inbound Lead List (2026-08-25)
--
-- info@berwilson.com receives bid invitations, ITBs, and plan-room notices mixed
-- with a majority of marketing. None of it reached the platform: the sweep only
-- read moose@ and tuaone@.
--
-- The structural gap this closes: unqualified inbound had nowhere to live except
-- as a `project`. That is why 10 of 15 projects sit in pursuit/capture/bid
-- carrying $50B of notional pipeline into the dashboard, map, and daily brief.
-- A lead is the tier BEFORE stage one — it arrived, nobody owns it yet, and it
-- expires with its bid date. Promotion (assigning an owner) is what turns it
-- into a project, an opportunity, or a steel deal.

-- ── 1. Keep the two mail pipelines apart ────────────────────────────────────
-- The existing sweep groups threads into thread_clusters and stages them as
-- email_intake_sessions (104 pending already). Lead mail must never enter that
-- queue, so every thread now carries which pipeline owns it.
alter table email_threads
  add column if not exists pipeline text not null default 'deal';

alter table email_threads
  drop constraint if exists email_threads_pipeline_check;
alter table email_threads
  add constraint email_threads_pipeline_check check (pipeline in ('deal', 'lead'));

-- The lead triage phase's hot path: "which lead threads still need triaging".
create index if not exists idx_email_threads_pipeline_state
  on email_threads(pipeline, summary_state, last_at desc);

-- ── 2. Leads ────────────────────────────────────────────────────────────────
create table if not exists leads (
  id uuid default gen_random_uuid() primary key,

  -- The thread this lead was read from. Cascade: no thread, no lead.
  thread_id uuid not null references email_threads(id) on delete cascade,
  mailbox text,

  -- Where it belongs. 'unknown' means triage could not tell — it still shows in
  -- the queue rather than being silently dropped.
  route text not null default 'unknown'
    check (route in ('steel', 'dino', 'construction', 'corporate', 'unknown')),

  -- new      — triaged as a real lead, awaiting a human decision
  -- reviewing— someone has picked it up
  -- promoted — became a project / opportunity / steel deal
  -- forwarded— handed to Dino by email
  -- ignored  — human said no
  -- expired  — bid date passed with no decision
  -- spam     — triage rejected it. Kept, not deleted: the "Show filtered"
  --            toggle over these rows is what makes the filter trustworthy.
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'promoted', 'forwarded', 'ignored', 'expired', 'spam')),

  -- Why triage rejected it, in plain language. Only set when status='spam'.
  spam_reason text,

  -- ── What arrived ──────────────────────────────────────────────────────────
  title text not null,
  received_at timestamptz,
  sender_name text,
  sender_email text,
  sender_company text,
  sender_phone text,

  -- ── What the AI extracted ────────────────────────────────────────────────
  summary text,
  scope text,
  location text,
  -- Deliberately text, not the project_sector enum: the model's output is not
  -- trusted enough to be constrained here. Promotion casts and validates.
  sector text,
  estimated_value numeric(15,2),

  solicitation_number text,
  bid_due_date date,
  site_visit_date date,
  rfi_due_date date,

  key_facts jsonb not null default '[]'::jsonb,
  -- Bonding, certifications, insurance, prevailing wage, set-aside status…
  requirements jsonb not null default '[]'::jsonb,
  triage_confidence numeric(3,2),

  -- ── Fit assessment (from assessFit — same shape the proposal wizard shows) ─
  fit_score integer check (fit_score is null or (fit_score >= 0 and fit_score <= 100)),
  fit_recommendation text
    check (fit_recommendation is null or fit_recommendation in ('pursue', 'consider', 'pass')),
  fit_summary text,
  fit_strengths jsonb not null default '[]'::jsonb,
  fit_concerns jsonb not null default '[]'::jsonb,
  fit_gaps jsonb not null default '[]'::jsonb,
  fit_questions jsonb not null default '[]'::jsonb,

  -- ── Attachments staged from the thread (StagedAttachment shape) ──────────
  attachments jsonb not null default '[]'::jsonb,

  -- pending  — triaged, not yet scored
  -- scored   — attachments pulled and assessFit ran
  -- failed   — scoring errored; retryable
  -- skipped  — spam, or nothing worth scoring
  score_state text not null default 'pending'
    check (score_state in ('pending', 'scored', 'failed', 'skipped')),
  score_error text,

  -- ── Where it went ────────────────────────────────────────────────────────
  promoted_project_id uuid references projects(id) on delete set null,
  promoted_opportunity_id uuid references opportunities(id) on delete set null,
  promoted_steel_deal_id uuid references steel_deals(id) on delete set null,
  promoted_at timestamptz,
  forwarded_to text,
  forwarded_at timestamptz,

  notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One lead per thread. Re-triaging a thread updates in place rather than
-- stacking duplicates in the queue.
create unique index if not exists idx_leads_thread on leads(thread_id);

-- The queue's default ordering: open work, soonest bid first.
create index if not exists idx_leads_open
  on leads(bid_due_date nulls last, fit_score desc)
  where status in ('new', 'reviewing');
create index if not exists idx_leads_route on leads(route, status);
create index if not exists idx_leads_score_state
  on leads(score_state) where score_state = 'pending';

-- ── 3. Drive-sourced knowledge documents ────────────────────────────────────
-- Lets the nightly Drive sync tell "already indexed, unchanged" from "new or
-- edited" without re-downloading and re-embedding the whole folder each night.
alter table documents add column if not exists drive_file_id text;
alter table documents add column if not exists drive_modified_at timestamptz;

create unique index if not exists idx_documents_drive_file
  on documents(drive_file_id) where drive_file_id is not null;

-- ── 4. Triggers ─────────────────────────────────────────────────────────────
-- Reuses update_updated_at from 00006_triggers.sql. Deliberately NOT attaching
-- log_activity() — it dereferences new.project_id, which leads does not have
-- (the same trap already documented on opportunities and the sweep tables).
drop trigger if exists set_updated_at on leads;
create trigger set_updated_at before update on leads
  for each row execute function update_updated_at();

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
-- App traffic uses the service role; RLS is defense-in-depth (CLAUDE.md §8).
-- These rows carry email content, so reads are authenticated-only. The sweep is
-- the sole writer; the UI mutates through service-role API routes.
alter table leads enable row level security;

drop policy if exists "leads_select" on leads;
create policy "leads_select" on leads
  for select using (auth.role() = 'authenticated');
