-- Email intake sessions: staging state for the Email Ingestion module.
-- A human pastes/uploads an n8n email-research package into /email-ingestion;
-- the platform runs one Gemini pass (map → match → fit), stages the result here
-- (status = pending), the user reviews + edits, then confirm creates the records
-- (opportunity OR project + parties + tasks) and flips status = confirmed.
--
-- Mirrors proposal_intake_sessions, but the extraction is the unified email-intake
-- shape (see src/lib/ai/prompts/email-intake.ts) and it can create an opportunity
-- as well as a project. Type/status are plain text + app constants.

create table if not exists email_intake_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,                                       -- who ran the ingest (nullable — falls back to SYSTEM_USER_ID)
  status text not null default 'pending',             -- pending | confirmed | dismissed
  label text,                                         -- export label / search term from the n8n report

  raw_text text,                                      -- the pasted/uploaded research document
  extraction_result jsonb not null,                   -- EmailIntakeExtraction (mapped record + people + tasks)
  match_candidates jsonb default '[]',                -- MatchCandidate[] (existing projects)
  party_matches jsonb default '[]',                   -- PartyMatch[] (existing contacts)
  fit_assessment jsonb,                               -- FitAssessment | null

  created_record_ids jsonb,                           -- {opportunity_id?, project_id?, party_ids[], task_ids[]}

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  confirmed_at timestamptz
);

create index if not exists idx_email_intake_sessions_status on email_intake_sessions(status, updated_at desc);

-- updated_at trigger (reuses update_updated_at from 00006_triggers.sql).
-- Deliberately NOT attaching log_activity() — it dereferences new.project_id,
-- which this table doesn't have (same trap noted for opportunities).
create trigger set_updated_at
  before update on email_intake_sessions
  for each row execute function update_updated_at();

-- RLS — authenticated full access (app traffic uses the service role; RLS is
-- defense-in-depth per CLAUDE.md §8).
alter table email_intake_sessions enable row level security;
create policy "email_intake_select" on email_intake_sessions for select using (auth.role() = 'authenticated');
create policy "email_intake_insert" on email_intake_sessions for insert with check (auth.role() = 'authenticated');
create policy "email_intake_update" on email_intake_sessions for update using (auth.role() = 'authenticated');
create policy "email_intake_delete" on email_intake_sessions for delete using (auth.role() = 'authenticated');
