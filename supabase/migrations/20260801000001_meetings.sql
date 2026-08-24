-- Meetings & Interaction Records — a durable, browsable, compliance-grade
-- register of board/governance meetings (company scope) and per-project client
-- interactions (project scope). Each record can carry the iPhone audio
-- recording, a pasted transcript, and supporting exhibits (all reused from the
-- existing `documents` infra via a new documents.meeting_id link).
--
-- Distinct from the ephemeral Meeting Notes Intake pipeline
-- (email_intake_sessions / intake_kind='meeting'), which fans a transcript onto
-- OTHER records and keeps no browsable meeting entity. This IS the entity.
--
-- Follows the dino/investors template: uuid PK, FKs on delete set null, plain
-- text vocab via CHECK (no Postgres enums; src/lib/utils/meetings.ts is the
-- source of truth), set_updated_at trigger only (NOT log_activity() — it
-- dereferences new.project_id unconditionally), RLS as defense-in-depth (the
-- real boundary is the middleware: /company/board + /api/meetings are admin-only
-- by default-deny; project-scoped writes also check canAccessProject in-route).

-- ============================================================
-- meetings — the record
--   scope 'company' → board / governance minutes (project_id null)
--   scope 'project' → client interaction on a specific project (project_id set)
-- ============================================================
create table if not exists meetings (
  id uuid default gen_random_uuid() primary key,
  kind text not null default 'client',        -- board | client | site_visit | call | internal | other
  scope text not null default 'project',      -- company | project
  project_id uuid references projects(id) on delete set null,
  title text not null,
  meeting_date date not null,
  meeting_time text,                           -- freeform, e.g. "10 AM MST"
  location text,
  meeting_type_label text,                     -- freeform, e.g. "Special Board Meeting"
  chair text,
  secretary text,
  attendees jsonb not null default '[]'::jsonb,   -- [{name, role, org}]
  summary text,
  minutes text,                                -- authoritative minutes / notes (markdown) — the record body
  transcript text,                             -- pasted raw transcript from the recording
  decisions jsonb not null default '[]'::jsonb,   -- resolutions / decisions, one string each
  status text not null default 'draft',        -- draft | approved
  approved_at timestamptz,
  approved_by text,
  confidential boolean not null default false,
  index_ai boolean not null default false,     -- embed minutes/transcript for Ber AI (board off, project on by default)
  transcription_status text,                   -- null/idle | processing | complete | error (local Whisper on the audio)
  minutes_document_id uuid references documents(id) on delete set null,  -- generated .md copy (for download + optional embedding)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint meetings_kind_check check (kind in ('board', 'client', 'site_visit', 'call', 'internal', 'other')),
  constraint meetings_scope_check check (scope in ('company', 'project')),
  constraint meetings_status_check check (status in ('draft', 'approved')),
  -- a project-scoped meeting must name a project; a company-scoped one must not
  constraint meetings_scope_project_check check (
    (scope = 'project' and project_id is not null) or
    (scope = 'company' and project_id is null)
  )
);

create index if not exists idx_meetings_scope_date on meetings(scope, meeting_date desc);
create index if not exists idx_meetings_project on meetings(project_id);
create index if not exists idx_meetings_kind on meetings(kind);

-- idempotent for an already-created table (the column was added after the
-- initial meetings ship): local Whisper transcription status on the audio.
alter table meetings add column if not exists transcription_status text;

-- ============================================================
-- documents.meeting_id — attach the recording / transcript / exhibits to a
-- meeting. A meeting's files = documents where meeting_id = X. Reuses all
-- existing document infra (upload, signed URLs, list, delete, AI pass).
--
-- ON DELETE CASCADE: a meeting attachment is scoped ONLY by meeting_id, so it's
-- meaningless without its meeting — deleting the meeting deletes its files (and
-- their chunks cascade in turn). SET NULL would leave a scopeless row that
-- violates documents_scope_check. (The API DELETE route also removes the
-- storage objects, which a DB cascade can't reach.)
-- ============================================================
alter table documents add column if not exists meeting_id uuid references meetings(id) on delete cascade;
create index if not exists idx_documents_meeting on documents(meeting_id);

-- A meeting attachment (audio / exhibit) is scoped by meeting_id alone (no
-- project/entity/company), so widen documents_scope_check to accept it —
-- otherwise the "a document must have a scope" check rejects meeting files.
alter table documents drop constraint if exists documents_scope_check;
alter table documents add constraint documents_scope_check check (
  project_id is not null or entity_id is not null or is_company or is_reference or meeting_id is not null
);

-- ============================================================
-- updated_at trigger (reuses update_updated_at from 00006_triggers.sql)
-- ============================================================
create trigger set_updated_at
  before update on meetings
  for each row execute function update_updated_at();

-- ============================================================
-- RLS — authenticated users get full access (app traffic uses the service
-- role; RLS is defense-in-depth, per CLAUDE.md §8).
-- ============================================================
alter table meetings enable row level security;
create policy "meetings_select" on meetings for select using (auth.role() = 'authenticated');
create policy "meetings_insert" on meetings for insert with check (auth.role() = 'authenticated');
create policy "meetings_update" on meetings for update using (auth.role() = 'authenticated');
create policy "meetings_delete" on meetings for delete using (auth.role() = 'authenticated');

-- ============================================================
-- Storage bucket — allow audio (iPhone voice memos) + raise the size limit for
-- long board recordings. The 'documents' bucket enforces allowed_mime_types at
-- .upload() time. CRITICAL: when allowed_mime_types is NULL the bucket is
-- UNRESTRICTED (all types allowed) — and `NULL || array[...]` collapses to just
-- the audio types, which would silently reject pdf/text/docx everywhere. So
-- only APPEND when a restrictive allowlist already exists; leave NULL as NULL.
-- (The self-hosted Studio bucket is NULL, so it stays unrestricted; a fresh
-- Supabase install seeded by 20260505000002 gets audio appended to its list.)
-- ============================================================
update storage.buckets
set allowed_mime_types = case
      when allowed_mime_types is null then null
      else allowed_mime_types || array[
        'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/mpeg', 'audio/wav',
        'audio/x-wav', 'audio/aac', 'audio/webm', 'audio/ogg'
      ]
    end,
    file_size_limit = 524288000   -- 500 MB
where id = 'documents';
