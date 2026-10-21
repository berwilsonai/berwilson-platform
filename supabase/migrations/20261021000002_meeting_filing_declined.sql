-- "This call belongs to no deal" has to be a recordable answer.
--
-- ⚠ WITHOUT IT, A MEETING THAT IS GENUINELY NOT ABOUT A DEAL IS AN OPEN ITEM
-- FOREVER. Three of the nine unfiled meetings found on 2026-10-21 are real
-- recordings that correctly belong to no project or opportunity: a 186-second
-- monologue in which Richard introduces himself and the company, an internal
-- session on consolidating R&D and taking Murray RDA office space, and a first
-- look at a Delby Digital prospect that never became a record. Every pass over
-- them must refuse to file them — correctly — and so they would sit in the
-- queue being re-refused on every sweep, which is indistinguishable from a
-- backlog nobody is working.
--
-- THE ROW IS THE TOMBSTONE, which is the house pattern and not a new idea:
-- `documents.excluded_at`/`excluded_reason` carry exactly this answer for a
-- file that is not company knowledge (CLAUDE.md §12), and `commitments` carries
-- `dismissed` for an obligation that was a misread. A declined meeting is NOT
-- deleted: its transcript stays indexed and quotable, it stays on its
-- attendees' profiles, and clearing the two columns puts it back in the queue.
--
-- ⚠ DELIBERATELY NOT A NEW VALUE ON `status`. That column means draft →
-- approved — whether the MINUTES are agreed — and §4 says it stays `draft`
-- until a human approves. "Not about a deal" is an orthogonal fact: a declined
-- meeting can still have its minutes approved. One column, one question.
alter table meetings
  add column if not exists filing_declined_at timestamptz,
  add column if not exists filing_declined_reason text;

comment on column meetings.filing_declined_at is
  'A human has said this call belongs to no project or opportunity (an internal '
  'session, a monologue, a prospect with no record). Out of the unfiled queue, '
  'still fully searchable. Clear it to reconsider.';

comment on column meetings.filing_declined_reason is
  'Why, in words a reader can disagree with. Required in practice — a tombstone '
  'with no reason cannot be re-examined.';

-- The unfiled queue is "on no record AND not declined", so the partial index
-- added yesterday has to carry the second half or every reader re-filters it.
drop index if exists idx_meetings_unfiled;
create index if not exists idx_meetings_unfiled
  on meetings (meeting_date desc)
  where scope = 'unfiled' and filing_declined_at is null;
