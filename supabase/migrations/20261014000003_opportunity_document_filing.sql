-- Opportunity documents get the two governance columns `documents` already has.
--
-- WHY: a filing audit over both tables was written, ran green, and reported
-- nothing wrong with any of the 103 opportunity documents -- because the query
-- named `excluded_at` and `filing_confirmed_at`, which exist on `documents` and
-- not here. PostgREST answered 42703 and the caller read `data` as null. A
-- broken query and a clean corpus are the same number on screen (§12), so half
-- the document corpus was unauditable AND looked audited.
--
-- `filing_confirmed_at` is the one that matters for the queue: the misfiling
-- queues are COMPUTED from the records rather than stored, so without a place
-- to record "it is right where it is" a proposal reappears on every page load
-- however many times it is dismissed -- and a queue that cannot reach zero
-- teaches people to accept rows to make them go away.
--
-- `excluded_at`/`excluded_reason` come along for the same reason they exist on
-- `documents`: the ROW IS THE TOMBSTONE. A hard delete of a Drive-sourced row
-- is futile, because the sync's `known` map is built from existing rows, so the
-- file looks new and is re-imported the same night.

alter table opportunity_documents
  add column if not exists excluded_at timestamptz,
  add column if not exists excluded_reason text,
  add column if not exists filing_confirmed_at timestamptz;

-- Partial, like the `documents` pair: the overwhelming majority of rows are
-- neither excluded nor confirmed, and a full index on two mostly-null columns
-- is pages of nothing.
create index if not exists idx_opportunity_documents_excluded
  on opportunity_documents (excluded_at) where excluded_at is not null;

comment on column opportunity_documents.filing_confirmed_at is
  'A human has said this document belongs on this opportunity. Takes it out of the misfiling queue; it stays listed on the record.';
comment on column opportunity_documents.excluded_at is
  'Set aside as not a document (a photo, a logo, a calendar invite). The row is kept as a tombstone so the nightly Drive sync cannot re-import it.';
