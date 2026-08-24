-- Google Workspace migration (2026-08-23)
--
-- Outlook/Microsoft Graph is gone. Auth is now a service account with
-- domain-wide delegation, which stores NO tokens — so email_tokens disappears
-- rather than being ported, taking an RLS hole with it (that table granted
-- SELECT on raw access + refresh tokens to every authenticated user).
--
-- graph_subscriptions and processed_emails are dropped as dead code: neither
-- had a single read or write anywhere in src/ — they were scaffolding for a
-- webhook pipeline that was never finished.
--
-- Adds the state the full-mailbox sweep needs to run for hours and resume
-- after a crash: mailbox_sync (per-mailbox cursor), email_threads (one row per
-- deduped thread + its AI summary), thread_clusters (threads grouped into a
-- candidate deal, which becomes one email_intake_sessions review).

-- ── 1. Drop the Microsoft-era tables ────────────────────────────────────────
drop table if exists graph_subscriptions;
drop table if exists processed_emails;
drop table if exists email_tokens;

alter table updates drop column if exists outlook_web_link;

-- ── 2. Per-mailbox sweep cursor ─────────────────────────────────────────────
create table if not exists mailbox_sync (
  mailbox text primary key,

  -- Gmail's opaque pagination cursor. Checkpointed after every page so a
  -- restart resumes mid-backfill instead of starting over.
  page_token text,

  state text not null default 'idle',        -- idle | running | complete | failed
  since_days integer,                        -- null = all history

  threads_seen integer not null default 0,
  threads_new integer not null default 0,
  duplicates_skipped integer not null default 0,

  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz default now()
);

-- ── 3. Threads: the map phase ───────────────────────────────────────────────
create table if not exists email_threads (
  id uuid default gen_random_uuid() primary key,

  -- RFC 2822 Message-ID of the thread's earliest message. Gmail's threadId is
  -- per-mailbox, so the same conversation in moose@ and tuaone@ has two ids
  -- but one fingerprint — this is what stops the CRM double-ingesting it.
  fingerprint text not null unique,

  mailbox text not null,                     -- where this copy was read from
  gmail_thread_id text not null,

  subject text,
  participants text[] default '{}',
  first_at timestamptz,
  last_at timestamptz,
  message_count integer default 0,
  attachment_count integer default 0,

  -- Rendered markdown of the whole thread. Kept because the reduce phase and
  -- the confirmed record's report document both need the source text.
  raw_markdown text,

  -- ThreadSummary from the map pass (see src/lib/ai/prompts/thread-summary.ts)
  summary jsonb,
  summary_state text not null default 'pending',  -- pending | summarized | failed | skipped
  summary_error text,

  -- Set once the thread is grouped into a candidate deal.
  cluster_id uuid,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- The sweep's hot paths: "what still needs summarizing" and "what isn't clustered".
create index if not exists idx_email_threads_summary_state
  on email_threads(summary_state, last_at desc);
create index if not exists idx_email_threads_cluster
  on email_threads(cluster_id) where cluster_id is not null;
create index if not exists idx_email_threads_unclustered
  on email_threads(last_at desc) where cluster_id is null and summary_state = 'summarized';
create index if not exists idx_email_threads_participants
  on email_threads using gin(participants);

-- ── 4. Clusters: the reduce phase ───────────────────────────────────────────
create table if not exists thread_clusters (
  id uuid default gen_random_uuid() primary key,

  label text,                                -- human-readable deal name
  state text not null default 'open',        -- open | staged | dismissed
  reason text,                               -- why these threads were grouped

  -- Cached rollups so the queue lists without joining every thread.
  thread_count integer default 0,
  participants text[] default '{}',
  first_at timestamptz,
  last_at timestamptz,

  -- The review session this cluster produced, once staged.
  session_id uuid references email_intake_sessions(id) on delete set null,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_thread_clusters_state
  on thread_clusters(state, last_at desc);

alter table email_threads
  add constraint email_threads_cluster_fk
  foreign key (cluster_id) references thread_clusters(id) on delete set null;

-- ── 5. Sessions gain a cluster backlink ─────────────────────────────────────
alter table email_intake_sessions
  add column if not exists cluster_id uuid references thread_clusters(id) on delete set null;

-- ── 6. Triggers ─────────────────────────────────────────────────────────────
-- Reuses update_updated_at from 00006_triggers.sql. Deliberately NOT attaching
-- log_activity() — it dereferences new.project_id, which none of these have
-- (same trap already noted on opportunities and email_intake_sessions).
create trigger set_updated_at before update on mailbox_sync
  for each row execute function update_updated_at();
create trigger set_updated_at before update on email_threads
  for each row execute function update_updated_at();
create trigger set_updated_at before update on thread_clusters
  for each row execute function update_updated_at();

-- ── 7. RLS ──────────────────────────────────────────────────────────────────
-- App traffic uses the service role; RLS is defense-in-depth (CLAUDE.md §8).
-- These hold email bodies, so reads are authenticated-only and writes are
-- service-role-only — the sweep is the sole writer.
alter table mailbox_sync enable row level security;
alter table email_threads enable row level security;
alter table thread_clusters enable row level security;

create policy "mailbox_sync_select" on mailbox_sync
  for select using (auth.role() = 'authenticated');
create policy "email_threads_select" on email_threads
  for select using (auth.role() = 'authenticated');
create policy "thread_clusters_select" on thread_clusters
  for select using (auth.role() = 'authenticated');

-- Reviewers dismiss clusters from the UI; everything else is service-role.
create policy "thread_clusters_update" on thread_clusters
  for update using (auth.role() = 'authenticated');
