-- Dedupe attachments on CONTENT, because neither name nor size can do it.
--
-- The importer deduped on file name alone, deliberately: a bid package resends
-- the same drawing on every reply, and keying on name+size let re-encoded copies
-- of one document through (measured then: one briefing at 205,839 and 211,664
-- bytes, a Myton memo at 134,676 and 134,980).
--
-- ⚠ THE COST OF THAT CHOICE WAS ONLY VISIBLE ONCE FOUR SIBLING THREADS ARRIVED
-- AT ONCE. Highland Title sends one thread per parcel, and every thread carries a
-- "Title Commitment - AS.pdf" and a "Plat Map.pdf". Measured 2026-09-25 across
-- the four Carbon County parcels:
--
--   Title Commitment - AS.pdf   1,091,743 · 1,093,633 · 1,097,014 · 1,103,229
--   Plat Map.pdf                   94,853 ·   197,676 ·   275,927 ·   377,644
--
-- Four different parcels' title commitments, within 1.1% of each other — so a
-- size tolerance wide enough to catch a re-encode is also wide enough to discard
-- three of these, and the name rule discarded all three regardless. Six documents
-- on a live land acquisition vanished without an error anywhere.
--
-- A hash answers the question the other two only approximate: is this the same
-- FILE. Identical bytes are a resend and are skipped; different bytes under the
-- same name are different documents and are kept, under a name that says which
-- parcel they belong to. The remaining error — a genuinely re-encoded resend
-- across two threads — now produces a visible near-duplicate instead of a silent
-- deletion, which is the cheaper of the two by a wide margin.
alter table documents
  add column if not exists content_sha256 text;

comment on column documents.content_sha256 is
  'SHA-256 of the stored bytes, for attachment dedupe. Null for documents that predate it and for anything not imported from mail.';

-- The lookup is "does this record already hold these exact bytes", so the index
-- is per-record. Partial: only mail-imported documents carry a hash.
create index if not exists idx_documents_content_hash
  on documents (project_id, content_sha256)
  where content_sha256 is not null;

alter table opportunity_documents
  add column if not exists content_sha256 text;

create index if not exists idx_opportunity_documents_content_hash
  on opportunity_documents (opportunity_id, content_sha256)
  where content_sha256 is not null;
