-- Which email thread delivered a document.
--
-- The attachment import discarded this: an imported file landed on the record
-- with `source = 'document'` and nothing saying where it came from, so the two
-- places a document's text can live — `chunks` (indexed as a document) and
-- `thread_chunks` (indexed as its thread's attachment) — could not be
-- reconciled against each other. Measured 2026-10-15: 63 of 89 correspondence
-- documents held 1,074 chunks that already existed verbatim in `thread_chunks`,
-- the same bytes embedded twice into two corpora.
--
-- With the thread on the row, the pair (source_thread_id, file_name) answers
-- "is this document's text already searchable through the mail index?" exactly,
-- rather than by matching a file name across the whole corpus — and a file name
-- is not evidence of sameness.
--
-- ON DELETE SET NULL, not CASCADE: the thread is how the document ARRIVED, not
-- what it belongs to. Dropping a swept thread must never delete a deed.

alter table documents
  add column if not exists source_thread_id uuid references email_threads(id) on delete set null;

alter table opportunity_documents
  add column if not exists source_thread_id uuid references email_threads(id) on delete set null;

comment on column documents.source_thread_id is
  'The email_threads row whose attachment became this document. NULL for a hand upload, a Drive sync, or any import predating 2026-10-15. Paired with file_name it identifies the document''s text in thread_chunks.';

comment on column opportunity_documents.source_thread_id is
  'The email_threads row whose attachment became this document. NULL for a hand upload, a Drive sync, or any import predating 2026-10-15. Paired with file_name it identifies the document''s text in thread_chunks.';

-- Partial: the reconcile pass and the provenance badge both only ever ask about
-- rows that HAVE a thread, and the great majority never will.
create index if not exists idx_documents_source_thread
  on documents (source_thread_id) where source_thread_id is not null;

create index if not exists idx_opportunity_documents_source_thread
  on opportunity_documents (source_thread_id) where source_thread_id is not null;
