-- A supersession the SOURCE made is the source's to undo. One a HUMAN made is not.
--
-- 20260930000003 fixed this for "not knowledge" (excluded_at) and left it for
-- "retired". The sync's `returning` branch treats any superseded row whose file
-- is still in a nominated folder as news and calls restoreDocument() on it — so
-- the Retire button on the Documents tab, and every duplicate the deduper found,
-- were undone on the next nightly run. Measured 2026-10-09: of 15 superseded
-- rows, the 10 that survived were files that had genuinely left Drive and the 5
-- others had no drive_file_id at all. No Drive-sourced document has ever been
-- durably retired by hand, and `scripts/dedupe-documents.mts` knew it — it
-- refused to act on 48 of the 53 duplicate groups it found, for exactly this
-- reason.
--
-- The lock is what makes the decision stick. Set by a human retiring a document
-- or by the deduper; never by the vanish path, which must stay free to restore a
-- file that comes back out of an Archive folder.
alter table documents
  add column if not exists superseded_by_hand boolean not null default false;

comment on column documents.superseded_by_hand is
  'True when a person (or the deduper acting on their behalf) retired this document, as opposed to it vanishing from Drive. The importers may not restore it — only clearing the flag does.';

-- WHICH document this one duplicates. A reason string cannot be followed, joined
-- or undone; a pointer can, so the screen can say "duplicate of <name>" with a
-- link to the copy that was kept, and "not a duplicate" is one click.
--
-- ON DELETE SET NULL, not CASCADE: deleting the surviving copy must never delete
-- the evidence that a decision was made about this one. It is left retired with
-- its reason text, which is the honest state — somebody still has to look.
alter table documents
  add column if not exists duplicate_of uuid references documents(id) on delete set null;

comment on column documents.duplicate_of is
  'The document this one duplicates. Set only alongside superseded_at + superseded_by_hand; the row, the stored file and its place on the record all survive.';

create index if not exists idx_documents_duplicate_of
  on documents (duplicate_of) where duplicate_of is not null;

-- The deduper's own five decisions from 09-18, which survived only because
-- those documents never came from Drive. They are human decisions by the same
-- definition, so they carry the flag and stop depending on that accident.
update documents
   set superseded_by_hand = true
 where superseded_at is not null
   and superseded_reason like 'duplicate of %';

-- The same two columns on the PARALLEL TABLE.
--
-- `opportunity_documents` is the other place a document can live (§9's two-table
-- split), so "have we already got these bytes" is always two questions — and a
-- dedupe pass that answers one of them is worse than none, because the half it
-- misses reads as clean. Measured 2026-10-09 once every row was hashed: 29
-- duplicate groups across 101 opportunity documents, 31 redundant copies — 31%
-- of the table, a higher share than `documents` carried.
alter table opportunity_documents
  add column if not exists superseded_by_hand boolean not null default false;

alter table opportunity_documents
  add column if not exists duplicate_of uuid references opportunity_documents(id) on delete set null;

comment on column opportunity_documents.superseded_by_hand is
  'True when a person (or the deduper acting on their behalf) retired this document. No importer may restore it.';

comment on column opportunity_documents.duplicate_of is
  'The opportunity document this one duplicates. Set only alongside superseded_at + superseded_by_hand.';

create index if not exists idx_opportunity_documents_duplicate_of
  on opportunity_documents (duplicate_of) where duplicate_of is not null;

-- Repair: a LIVE row may not carry the lock.
--
-- The restore this release replaces cleared `superseded_at` and left
-- `superseded_by_hand` set, because the flag did not exist when it was written.
-- Four rows reached that state within an hour of this session's dedupe, when the
-- hourly drive-watch cron ran against the build that predated the fix — and the
-- importers read the flag to decide what not to restore, so a live row holding it
-- would be skipped by the sync forever and never updated again. The importers now
-- require both columns; this clears the rows that already drifted.
update documents
   set superseded_by_hand = false, duplicate_of = null
 where superseded_at is null
   and (superseded_by_hand or duplicate_of is not null);

update opportunity_documents
   set superseded_by_hand = false, duplicate_of = null
 where superseded_at is null
   and (superseded_by_hand or duplicate_of is not null);
