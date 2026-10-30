-- A human's sign-off on one data-room section.
--
-- Richard, 2026-10-30: *"next to each folder, there is a check box. When checked
-- it will log which user checked it off… Checking it off will mean a human
-- adjudicated it and verified that is the most accurate and up to date doc."*
--
-- One row per section per record. Nineteen decisions per deal, which is a number
-- somebody will actually finish — the alternative was a tick per expected
-- document (119 per deal) and almost all of those would never be touched.
--
-- ⚠ WHY THE COUNT AND THE FINGERPRINT ARE HERE, AND THEY ARE THE POINT OF THE
-- TABLE. A sign-off is not a boolean about a folder; it is a statement about the
-- SET OF DOCUMENTS that was in the folder at the moment somebody looked. The
-- moment a document is added, removed or replaced, that statement no longer
-- describes what is there — the tick has not become false, it has become STALE,
-- and those are different things. So the set is fingerprinted when it is signed
-- and compared on every read. Clearing the tick silently would lose who looked;
-- keeping it silently would let a room read fully verified while documents
-- landed in it unexamined. §12: an orphaned projection looks perfectly live.
--
-- ⚠ AND THIS ONLY WORKS BECAUSE THE IMPORTER NOW NOTICES A MOVE. Until
-- 2026-10-30 a Drive move did not change `modifiedTime` and so never updated
-- `drive_folder_path` — meaning a document dragged between sections changed
-- neither fingerprint, and a sign-off would have looked current while the shelf
-- it described had been rearranged underneath it.

create table if not exists data_room_signoffs (
  id uuid default gen_random_uuid() primary key,

  -- The shared-children convention (§4): exactly one parent.
  project_id uuid references projects(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,

  -- A section key from src/lib/drive/data-room.ts — '01.5'. Plain text and not
  -- an FK because the sections are a fixed professional standard declared in
  -- code, not a value set that grows with the business. A key no template knows
  -- reads as no sign-off, which is the safe direction.
  section_key text not null,

  -- WHO. Bare uuid, no FK to auth.users — matching team_members.auth_user_id
  -- and step_up_sessions.auth_user_id, which take the same shape for the same
  -- reason (auth lives in its own schema and a cascade across it is not ours to
  -- define).
  signed_off_by uuid not null,
  -- ⚠ THE NAME IS SNAPSHOTTED, NOT JOINED. "Eric" is the answer to "who
  -- verified this", and it has to keep answering after a login is renamed,
  -- disabled or removed — the audit value of a sign-off is precisely that it
  -- survives the personnel change. The uuid is kept too, for anything that
  -- needs to resolve the live person.
  signed_off_by_name text,
  signed_off_at timestamptz not null default now(),

  -- WHAT WAS SIGNED. The live document count, and a sha256 over the sorted
  -- Drive file ids in the section. Any add, removal or replacement changes the
  -- fingerprint; the count alone would miss a one-for-one swap, which on a data
  -- room is the single most important change there is (a draft replaced by an
  -- executed copy).
  document_count integer not null default 0,
  document_fingerprint text,

  -- Why, when there is a why. A condition noted at sign-off is the thing a
  -- lender asks about first.
  note text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint data_room_signoffs_scope_check
    check (num_nonnulls(project_id, opportunity_id) = 1),

  -- ⚠ `nulls not distinct` IS LOAD-BEARING. Exactly one parent column is NULL
  -- on every row by construction, and under Postgres's DEFAULT rule two NULLs
  -- never equal each other — so a plain unique key here would treat every
  -- re-sign as a brand new row, never fire ON CONFLICT, and stack duplicate
  -- sign-offs for one section. The constraint would look present and enforce
  -- nothing. Same shape as the partial-index trap in §12, and the same fix
  -- `project_parcels` already uses.
  unique nulls not distinct (project_id, opportunity_id, section_key)
);

create index if not exists idx_data_room_signoffs_project
  on data_room_signoffs(project_id) where project_id is not null;
create index if not exists idx_data_room_signoffs_opportunity
  on data_room_signoffs(opportunity_id) where opportunity_id is not null;

alter table data_room_signoffs enable row level security;

drop policy if exists "data_room_signoffs_select" on data_room_signoffs;
create policy "data_room_signoffs_select" on data_room_signoffs
  for select using (auth.role() = 'authenticated');
drop policy if exists "data_room_signoffs_insert" on data_room_signoffs;
create policy "data_room_signoffs_insert" on data_room_signoffs
  for insert with check (auth.role() = 'authenticated');
drop policy if exists "data_room_signoffs_update" on data_room_signoffs;
create policy "data_room_signoffs_update" on data_room_signoffs
  for update using (auth.role() = 'authenticated');
drop policy if exists "data_room_signoffs_delete" on data_room_signoffs;
create policy "data_room_signoffs_delete" on data_room_signoffs
  for delete using (auth.role() = 'authenticated');

drop trigger if exists set_updated_at on data_room_signoffs;
create trigger set_updated_at before update on data_room_signoffs
  for each row execute function update_updated_at();

-- ⚠ THE APPEND-ONLY LOG IS WHAT HOLDS THE HISTORY, and the table only holds the
-- CURRENT state — one row per section, overwritten on a re-sign. "Eric signed
-- it off, Richard un-ticked it an hour later, Eric signed it again" is exactly
-- the sequence this feature exists to make auditable, and none of it survives in
-- the table. §4: a DELETE survives itself because log_activity() writes
-- to_jsonb(old) into metadata.
--
-- ⚠ AND MAKING A TABLE TRACKED MEANS AUDITING EVERY WRITE PATH TO IT IN THE SAME
-- CHANGE (§12) — a trail whose every row reads "system" answers nothing, which
-- is the only question it was added to answer. There is exactly one write path,
-- /api/dataroom/signoff, and it uses actorAdminClient().
drop trigger if exists log_data_room_signoffs on data_room_signoffs;
create trigger log_data_room_signoffs
  after insert or update or delete on data_room_signoffs
  for each row execute function log_activity();

comment on table data_room_signoffs is
  'A human''s sign-off on one data-room section: who, when, and a fingerprint of the document set they were looking at. The fingerprint is what makes a sign-off go STALE rather than silently wrong when the folder changes.';
comment on column data_room_signoffs.document_fingerprint is
  'sha256 over the sorted Drive file ids in the section at sign-off. The count alone would miss a one-for-one swap — a draft replaced by an executed copy — which is the most important change a data room sees.';
comment on column data_room_signoffs.signed_off_by_name is
  'Snapshotted, not joined: "who verified this" must keep answering after a login is renamed or removed.';
