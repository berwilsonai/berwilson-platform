-- A clock for the chase pass, because the column it had could never be one.
--
-- `chase_drafted_at` is set ONLY when a real Gmail draft was created, which is
-- deliberate: the commitments page reads it to tell the reader "this is already
-- sitting in your drafts" apart from "copy this text". But only info@ holds a
-- write scope, and 223 of 231 chaseable obligations sit on moose@/tuaone@
-- threads — so for ~96% of the work the pass composes a chase, stores it, and
-- leaves no timestamp anywhere.
--
-- The consequence is that nothing can tell whether the 05:30 job ran. §12: a
-- liveness check needs a CLOCK, not a count, and a count that has stopped
-- growing is indistinguishable from a quiet ledger. This is that clock, and it
-- is set whenever text is stored, draft or no draft.
alter table commitments
  add column if not exists chase_composed_at timestamptz;

comment on column commitments.chase_composed_at is
  'When the chase text was composed, draft or not. The health check''s clock; '
  '`chase_drafted_at` stays draft-only because the page distinguishes the two.';

-- Backfill what can be known. A row with a draft has its drafted time; a row
-- with text and no draft has no recorded moment, so it takes `updated_at` as
-- the closest honest approximation rather than now() — which would date the
-- whole existing backlog to this migration and start the clock on a lie.
update commitments
   set chase_composed_at = coalesce(chase_drafted_at, updated_at)
 where chase_text is not null
   and chase_composed_at is null;

create index if not exists idx_commitments_chase_composed
    on commitments (chase_composed_at desc nulls last);
