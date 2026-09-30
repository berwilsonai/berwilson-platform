-- Excluding a document from the company knowledge base has to STICK.
--
-- Before this, neither delete nor retire survived the nightly Drive sync:
--   * a hard DELETE removed the row, and syncDriveKnowledge builds its `known`
--     map from existing rows only — so the file looked new and was re-inserted
--     the next night;
--   * a retire set superseded_at, and the sync's `returning` branch treats a
--     superseded row whose file is still in a nominated folder as news and calls
--     restoreDocument() on it — actively undoing the decision.
-- So the Trash2 button on /company appeared to work and changed nothing.
--
-- The row itself is the tombstone. Keeping it preserves drive_file_id, whose
-- unique index then blocks any re-insert, and the sync skips an excluded row
-- outright. Nothing is destroyed, so the act is reversible: clear excluded_at
-- and the next run re-indexes the file.
alter table documents add column if not exists excluded_at timestamptz;
alter table documents add column if not exists excluded_reason text;

comment on column documents.excluded_at is
  'Set when a human says this file is not knowledge. The row is kept as a tombstone so the Drive sync cannot re-import it; its chunks are deleted so it leaves retrieval.';

create index if not exists idx_documents_excluded
  on documents (excluded_at) where excluded_at is not null;

-- A human confirming a document DOES belong where it is.
--
-- Without this the unfiled queue can never reach zero: it is computed from the
-- records rather than stored, so a document the matcher proposes a home for
-- comes back every time the page is loaded, however often it is dismissed. An
-- "it is fine where it is" decision has to be recordable, or the only way to
-- clear a row is to act on it — which is how a queue teaches people to accept
-- things to make them go away.
alter table documents add column if not exists filing_confirmed_at timestamptz;

comment on column documents.filing_confirmed_at is
  'Set when a human confirms this document belongs on the scope it already has. Takes it out of the unfiled-documents queue without changing anything about it.';
