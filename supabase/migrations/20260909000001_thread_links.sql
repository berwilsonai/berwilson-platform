-- Correspondence keeps records current (2026-09-09)
--
-- Mail was read once and filed once. Nothing carried a later reply back to the
-- record it belonged to, and — worse — the stored thread itself froze at first
-- capture, because fetch dedupes on the EARLIEST Message-ID in a conversation.
-- Verified against live Gmail before this change: of 40 sampled threads 3 had
-- grown since capture, one from 2 stored messages to 6.
--
-- Fixing the freeze is code. What needs schema is the question a reply asks and
-- the platform could not answer: "what record does this thread belong to?"
-- Linkage existed only as three partial answers — leads.promoted_*_id,
-- thread_clusters.session_id, email_intake_sessions.created_record_ids — none
-- of which a follow-up can be routed by.

-- ── 1. thread_links — the missing primitive ─────────────────────────────────
-- A table rather than columns on email_threads, because one email legitimately
-- belongs to several records: a referrer describing five deals in one message
-- becomes five leads, and every one of them wants that conversation.
create table if not exists thread_links (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references email_threads(id) on delete cascade,

  record_kind text not null check (
    record_kind in ('project', 'opportunity', 'lead', 'steel_deal')
  ),
  -- Deliberately NOT a foreign key: it points at four different tables, and a
  -- polymorphic FK is not expressible. Deletes are swept by the apply phase,
  -- which drops a link whose record has gone rather than failing on it.
  record_id uuid not null,

  -- 'linked'   — this thread IS that record (its lead was promoted to it, or
  --              its cluster was confirmed into it). No ambiguity.
  -- 'inferred' — matched by name, participants or solicitation number.
  -- This one column decides review posture everywhere, rather than the same
  -- judgement being re-derived at each write site.
  certainty text not null default 'inferred' check (certainty in ('linked', 'inferred')),
  confidence numeric,
  -- Human-readable, so a misfiling can be understood and undone rather than
  -- merely observed.
  reason text,

  -- How much of the conversation has already been written onto the record.
  -- Without this every refresh re-posts the whole thread, and a project's feed
  -- fills with the same correspondence night after night.
  applied_message_count integer not null default 0,
  last_applied_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (thread_id, record_kind, record_id)
);

-- The apply phase's hot path: links whose thread has outrun what was applied.
create index if not exists idx_thread_links_thread on thread_links(thread_id);
create index if not exists idx_thread_links_record on thread_links(record_kind, record_id);

drop trigger if exists set_updated_at on thread_links;
create trigger set_updated_at before update on thread_links
  for each row execute function update_updated_at();

alter table thread_links enable row level security;
drop policy if exists "thread_links_select" on thread_links;
create policy "thread_links_select" on thread_links
  for select using (auth.role() = 'authenticated');

-- ── 2. lead_notes — an activity feed on a lead ──────────────────────────────
-- Follows the convention of dino_notes / investor_notes / opportunity_notes /
-- steel_deal_notes / task_notes exactly. A lead that is refreshed by later mail
-- needs somewhere to say so; without it the refresh is invisible and the reader
-- cannot tell a re-read from a re-write.
create table if not exists lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  body text not null,
  -- Stamped server-side from the session, never taken from the client — the
  -- same rule every other notes table in this schema follows.
  author text,
  created_at timestamptz default now()
);

create index if not exists idx_lead_notes_lead on lead_notes(lead_id, created_at desc);

alter table lead_notes enable row level security;
drop policy if exists "lead_notes_select" on lead_notes;
create policy "lead_notes_select" on lead_notes
  for select using (auth.role() = 'authenticated');

-- ── 3. One email may describe several deals ─────────────────────────────────
-- Triage was one-lead-per-thread by construction: upsert(onConflict:'thread_id')
-- over a UNIQUE index. A referrer listing five projects collapsed into one row,
-- so none of the five could be scored, promoted or dismissed on its own.
--
-- thread_item is that email's ordinal. Re-triage upserts on (thread_id,
-- thread_item) so each detected opportunity keeps its slot instead of the run
-- stacking duplicates.
alter table leads add column if not exists thread_item integer not null default 0;

-- thread_id stays nullable, and Postgres treats NULLs as distinct, so web-form
-- leads (which have no mailbox behind them) are unaffected by the unique index.
--
-- Deliberately NOT a partial index. ON CONFLICT cannot use one unless the
-- statement repeats its predicate, which PostgREST has no way to express — an
-- upsert against a partial index fails outright with "no unique or exclusion
-- constraint matching the ON CONFLICT specification". The NULL-distinctness
-- above is what makes the predicate unnecessary anyway.
drop index if exists idx_leads_thread;
drop index if exists idx_leads_thread_item;
create unique index if not exists idx_leads_thread_item
  on leads(thread_id, thread_item);

-- ── 4. A cluster remembers what it became ───────────────────────────────────
-- thread_clusters knew which review SESSION it produced but not which record
-- that session created, and had no state past 'staged'. A follow-up on an
-- already-promoted deal attached to a staged cluster and stopped there.
--
-- state has no check constraint (verified), so 'confirmed' is app-level only —
-- the same approach the steel pipeline's 'invoiced' stage took.
alter table thread_clusters add column if not exists project_id uuid
  references projects(id) on delete set null;
alter table thread_clusters add column if not exists opportunity_id uuid
  references opportunities(id) on delete set null;
alter table thread_clusters add column if not exists confirmed_at timestamptz;

-- ── 5. A thread remembers whether it has been routed ────────────────────────
-- Routing processes a page at a time, and "no record matched" is a legitimate
-- outcome that leaves no row behind. Without a marker the phase would re-examine
-- the same newest page every run and never reach anything older.
--
-- Cleared when a thread is refreshed with new messages, because a conversation
-- that has grown may now match something it did not before.
alter table email_threads add column if not exists routed_at timestamptz;

create index if not exists idx_email_threads_unrouted
  on email_threads(last_at desc)
  where routed_at is null;
