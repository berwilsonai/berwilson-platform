-- A typed note on an opportunity carries what a typed update on a project
-- carries.
--
-- Until now `opportunity_notes` was body + author: embedded, so searchable,
-- and nothing else. The project path runs the same text through
-- /api/ai/extract and stores summary / waiting_on / risks / decisions on the
-- `updates` row, then turns the action items into real tasks. So one typed
-- paragraph produced follow-up work on a project and nothing at all on a
-- pursuit.
--
-- ⚠ WHY THE COLUMNS GO HERE RATHER THAN THE NOTES MOVING TO `updates`.
-- Measured 2026-10-18 before choosing: 90 notes across 6 opportunities, and
-- **86 of them were written by 'Ber AI'** (the mail sweep's own summaries),
-- 2 by Email ingestion, and 2 by a human. Migrating them into `updates` would
-- have meant rewiring 5 writers, their `chunks` rows (which point at
-- `opportunity_id` + source_type='opportunity_note', not `update_id`) and
-- auditing 23 readers — several of which read `updates` with NO project
-- filter and would then have picked up rows whose `project_id` is NULL, the
-- shape §12 records as breaking a security filter without touching it. All of
-- that to relocate 2 human rows. The pass is what must not fork (§12: "never
-- fork a shared pass — add a target"), and it does not: `logEntry` in
-- src/lib/records/log-entry.ts is one function with a target parameter.
--
-- Shaped to match `updates` exactly, so the shared renderer reads one shape:
-- the three arrays are NOT NULL with an empty-array default (write them with
-- `JsonIn`, never `Json` — §4), and `confidence` is the same numeric(3,2).
-- Every existing writer does a partial insert of (opportunity_id, body,
-- author); the defaults mean none of them changes.

alter table opportunity_notes
  add column if not exists summary    text,
  add column if not exists waiting_on jsonb not null default '[]'::jsonb,
  add column if not exists risks      jsonb not null default '[]'::jsonb,
  add column if not exists decisions  jsonb not null default '[]'::jsonb,
  add column if not exists confidence numeric(3,2);

comment on column opportunity_notes.summary is
  'The model''s read of the note, when it was extracted. NULL means saved as-is, which is a first-class choice and not a failure.';
comment on column opportunity_notes.confidence is
  'Extraction confidence 0-1, NULL when saved as-is. Read the verdict, never the number (§12).';

-- ⚠ NO BACKFILL, DELIBERATELY. 86 of the 90 existing notes are Ber AI's own
-- output, so re-extracting them is the model reading itself — the self-loop
-- failure that turned out to be 27% of the commitment ledger (§12). The two
-- human notes are not worth a pass. This is for what gets typed next.
