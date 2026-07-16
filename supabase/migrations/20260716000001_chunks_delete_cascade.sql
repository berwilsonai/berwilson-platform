-- Deleting a document (or update) must remove its indexed chunks with it.
--
-- The original FKs were ON DELETE SET NULL, which is doubly wrong:
--  1. chunks_source_check requires at least one source id, so the cascaded
--     SET NULL violates the check and the DELETE fails outright — this is
--     why removing an indexed company document errored ("Delete failed").
--  2. Even if it succeeded, the chunk would survive as an orphan and stale
--     content (old proposals, superseded docs) would keep surfacing in RAG.
--
-- Every other chunk source FK (entity, party, opportunity, investor,
-- opportunity_document, project) already cascades — this aligns the last two.

alter table chunks drop constraint chunks_document_id_fkey;
alter table chunks add constraint chunks_document_id_fkey
  foreign key (document_id) references documents(id) on delete cascade;

alter table chunks drop constraint chunks_update_id_fkey;
alter table chunks add constraint chunks_update_id_fkey
  foreign key (update_id) references updates(id) on delete cascade;
