-- The ORGANISER's title, on the meeting row itself.
--
-- ⚠ CLAUDE.md §4 ALREADY SAYS WHY THE TWO TITLES ARE DIFFERENT THINGS:
-- "`email_intake_sessions.source_title` holds the title the ORGANIZER typed,
-- apart from the model's rewrite in `extraction_result.title` — the first is
-- the filing key, the second is for reading." The meeting row only ever carried
-- the second one, and the consequence was measured on 2026-10-21: nine meetings
-- sat `scope='unfiled'` because the filing key lived on the intake session, and
-- when a human dismissed that session the key was orphaned. Nothing could file
-- them afterwards and nothing queued them.
--
-- The clearest case is the call whose organiser title is `Ber Wilson / Zenthium`
-- — which resolves to the Zenthium Partnership opportunity on an asserted alias
-- — and whose stored title is the model's "Steelton & Riverdale Site Reviews &
-- Power Capacity Analysis". §13 itself complained that it "does not look like a
-- Zenthium call in any list that shows the model's title". Both facts now live
-- on the row: one to file by, one to read.
alter table meetings
  add column if not exists source_title text;

comment on column meetings.source_title is
  'The title the ORGANISER typed (a calendar invite, a memo file name, a Drive '
  'folder). The FILING KEY: resolveMeetingTarget runs on this first, because '
  'the model''s rewrite in meetings.title names a topic rather than a record. '
  'Null for a hand-typed meeting, where the two are the same thing.';

-- Reconciling unfiled meetings reads exactly these rows, on every sweep.
create index if not exists idx_meetings_unfiled
  on meetings (meeting_date desc)
  where scope = 'unfiled';
