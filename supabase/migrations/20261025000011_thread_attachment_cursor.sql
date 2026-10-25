-- A thread's OWN attachment watermark, for mail that belongs to no record yet.
--
-- Attachment import has always been driven by a `thread_links` row: the cursor
-- is `thread_links.attachments_through` and the destination is that link's
-- record. So a thread with no link imported nothing, by construction.
--
-- Measured 2026-10-25, that is not an edge case — it is the majority. Only 244
-- of 1,984 deal threads (12%) carry any link, and across the deal pipeline:
--
--   relevance    linked   threads   attachments   imported
--   noise        no          191          331            0
--   operational  no          129          267            0
--   deal         no          102          211            0
--   deal         yes          78          263           86
--   noise        yes          37           61            9
--   operational  yes          22           32            4
--
-- 99 of 1,165 attachments imported — 809 of them on unlinked threads, in NO
-- corpus at all. Not documents, not mail chunks, not a queue, not a health
-- card. Among them, on threads the summarizer itself called `relevance='deal'`:
-- `Tensor Agreement`, `Tensor IQ Teaming Agreement 1.6`, `Most recent IDIQ for
-- 7 jurisdictions` (7 files), `Quit Claim Deed`, `Engagement letter`,
-- `Carbon County` (11 files), `Fwd: Defense Tech Park Carolina` (4).
--
-- ⚠ THE CURSOR CANNOT BE FAKED WITH A PLACEHOLDER LINK, which was the first
-- idea and the wrong one. `thread_links` means "this conversation is about this
-- record" and is read by the router, the apply pass, retrieval's filing filter,
-- the confidentiality filter and `reapOrphanedLinks`. A row pointing at nothing
-- would have to be special-cased in every one of them, and the one that forgot
-- would read a non-existent record as a real filing. The watermark belongs to
-- the THREAD, which is the thing that actually owns it — §12: ask what the
-- record OUTLIVES before choosing its parent. A thread outlives every link on
-- it, which is exactly why the unlinked case exists.
--
-- NOT NULL default 0 so the "how far have we read" question has the same answer
-- shape as the link cursor and no reader needs a coalesce.

alter table email_threads
  add column if not exists attachments_through integer not null default 0;

comment on column email_threads.attachments_through is
  'How many of this thread''s messages have had their attachments imported with '
  'NO record parent (the orphan path). The per-record watermark is '
  'thread_links.attachments_through and the two are independent: a thread can be '
  'read for one record and separately read as unparented.';

-- The selector for the orphan pass: deal mail carrying files it has not been
-- read for. Partial, so it stays small as the backlog drains.
create index if not exists idx_email_threads_attachments_pending
  on email_threads (last_at desc)
  where attachment_count > 0 and pipeline = 'deal';
