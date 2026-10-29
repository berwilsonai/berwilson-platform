-- The columns Richard's 00.2 tracker asks for, on the table that already holds
-- diligence items.
--
-- "00.2 — Master Document Index & Outstanding Items: include columns for
--  document name, status, responsible person, counterparty/source, document
--  date, expiration date if applicable, outstanding action, and deadline.
--  Track unresolved conditions in signed agreements, not just whether we have
--  a signed copy."
--
-- `dd_items` already carries four of those: `item` (document name), `status`,
-- `assigned_to` (responsible person, FK → parties) and `notes`. It is also
-- already a shared child of a project OR an opportunity under
-- `dd_items_scope_check`, so the tracker works on both kinds with no new
-- plumbing. Four columns are genuinely missing, plus two pointers.
--
-- ⚠ WHY NOT A NEW TABLE. The Diligence tab, the dashboard, the daily brief,
-- meeting prep and `attention-kinds.ts` all read `dd_items` today. A parallel
-- `data_room_items` table would be a second home for "what is unresolved on
-- this deal", and every one of those readers would see half the answer — the
-- exact failure §12 records as "an automatic producer must write the same table
-- the manual one does, or every reader sees only the hand-typed half".
--
-- ⚠ `status` STAYS TEXT, UNCONSTRAINED. It holds `open`/`in_progress`/
-- `resolved`/`accepted_risk` today and the tracker needs Richard's vocabulary
-- (Missing, Requested, Draft, Signed—Conditional, Effective, Expired, Not
-- Applicable, and In Progress/Final/Approved for reports and permits). Adding a
-- CHECK would mean a value outside it fails the WHOLE query with 22P02 rather
-- than the row (§12), and would freeze a vocabulary that is still settling. The
-- allowed set lives in src/lib/dataroom/status.ts beside the code that renders
-- it, and an unrecognised value renders as itself rather than blank.

alter table dd_items
  -- Which data-room section this item belongs to — '01.5'. Plain text, not an
  -- FK: the sections are declared in src/lib/drive/data-room.ts rather than in
  -- a table, because they are a fixed professional standard rather than a value
  -- set that grows with the business. A key no template declares reads as
  -- unsectioned, which is the safe direction.
  add column if not exists section_key text,

  -- The other side of the paper. Richard's "counterparty/source".
  add column if not exists counterparty text,

  -- The date ON the document, which is not the date we received it.
  add column if not exists document_date date,

  -- Richard's "expiration date if applicable" — a title commitment, a will-serve
  -- letter and a reservation deposit all lapse, and an expired document in a
  -- data room is worse than a missing one because it reads as satisfied.
  add column if not exists expires_on date,

  -- Kept APART from `notes` on purpose: `notes` is commentary, this is the one
  -- thing somebody has to do. A tracker that mixes them cannot be sorted by
  -- what is outstanding, which is the column a lender reads first.
  add column if not exists outstanding_action text,

  -- Richard's "deadline". Named `due_date` to match `tasks.due_date` and
  -- `milestones`, so every date a human is chased about reads the same.
  add column if not exists due_date date,

  -- The document on file that satisfies this item, when there is one.
  -- ⚠ DELIBERATELY NOT AN FK: a document lives in `documents` OR in
  -- `opportunity_documents` (§9's two-table split) and no single FK can point
  -- at both. `document_table` records which, exactly as `composed_documents`
  -- already does for the same reason.
  add column if not exists document_id uuid,
  add column if not exists document_table text;

-- The pair must agree: naming a document without saying which table it is in is
-- a pointer nothing can follow.
alter table dd_items drop constraint if exists dd_items_document_table_check;
alter table dd_items add constraint dd_items_document_table_check check (
  (document_id is null and document_table is null)
  or (document_id is not null and document_table in ('documents', 'opportunity_documents'))
);

-- The tracker reads a record's items by section, so that is the index.
create index if not exists idx_dd_items_section
  on dd_items (section_key)
  where section_key is not null;

comment on column dd_items.section_key is
  'Data-room section this item belongs to (''01.5''). Declared in src/lib/drive/data-room.ts, not in a table.';
comment on column dd_items.outstanding_action is
  'The one thing somebody must do. Kept apart from notes so a tracker can sort by what is outstanding — including a condition unresolved inside an agreement we have already signed.';
comment on column dd_items.document_table is
  'Which table document_id points into. Not an FK because a document lives in documents OR opportunity_documents.';
