-- A document off deal mail whose deal is NOT YET DECIDED — a real scope.
--
-- `documents_scope_check` requires every row to have one of: a project, an
-- entity, `is_company`, `is_reference`, a meeting or a steel deal. That list is
-- the set of answers to "what is this document OF", and until now there was no
-- member for the commonest case in the mail corpus: a file that arrived on deal
-- correspondence the router could not place. So the orphan import refused with
-- `documents_scope_check` on its very first live run — ⚠ found by RUNNING it,
-- with `tsc`, the build and 682 tests all green, because a CHECK is invisible to
-- every one of them (§12 — adding a discriminator means checking for a CHECK on
-- it).
--
-- ⚠ `is_reference` SATISFIES THE CONSTRAINT AND IS STILL THE WRONG ANSWER, which
-- was the first idea. That flag means "a human uploaded this to READ it" — it
-- backs the reference shelf on /intake, a deliberate reading list rendered 30
-- rows at a time, newest first, and `/intake/document/[id]` 404s on anything
-- without it. Routing 809 mail attachments through it would push every genuinely
-- uploaded document off that list and quietly change what the shelf means. A
-- purpose flag and a parentage state are two different questions; reusing one
-- for the other is how a surface stops being trustworthy.
--
-- So: a positive discriminator of its own (§12 — give it a positive
-- discriminator, keep the `is null` arm for older rows). The queue predicate
-- becomes one boolean instead of an inference across three nullable columns,
-- which also means the 13 pre-existing parentless rows — which came from
-- somewhere else and were never a filing question — are untouched and stay out.
--
-- LIFECYCLE, and it has to be complete or the queue cannot reach zero:
--   set    — by the orphan attachment import (`importUnparentedAttachments`)
--   cleared — by `refileDocument` when a human files it onto a deal, and by
--             `excludeDocument` when a human says it is not a document. Both
--             clear it in `src/lib/documents/refile.ts`, which is the one choke
--             point every filing door already goes through.

alter table documents
  add column if not exists awaiting_filing boolean not null default false;

comment on column documents.awaiting_filing is
  'Imported off deal mail with no record parent; a human has not yet said which '
  'deal it belongs to. Cleared by refileDocument/excludeDocument. NOT is_reference '
  '— that flag means a human uploaded it to read. See 20261025000012.';

-- ⚠ DROP AND RECREATE, NOT `create or replace` — a CHECK has no replace form, and
-- adding a second constraint instead would leave the old one still refusing the
-- row (both must pass). Named identically so nothing that looks it up by name
-- drifts.
alter table documents drop constraint if exists documents_scope_check;
alter table documents add constraint documents_scope_check check (
  project_id is not null
  or entity_id is not null
  or is_company
  or is_reference
  or meeting_id is not null
  or steel_deal_id is not null
  or awaiting_filing
);

-- The queue reads this and nothing else. Partial, so it stays small as the
-- backlog drains to zero — which is the whole point of the queue.
create index if not exists idx_documents_awaiting_filing
  on documents (uploaded_at desc)
  where awaiting_filing and superseded_at is null;
