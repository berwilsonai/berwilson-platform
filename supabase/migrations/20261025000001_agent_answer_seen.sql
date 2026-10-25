-- ============================================================================
-- "HAS THIS ANSWER BEEN SEEN?" — the column that lets a notification be decided
-- by ATTENTION rather than by a stopwatch.
--
-- Richard, 2026-10-25: "For Ask AI, I need to be able to close it while it
-- thinks. I don't want to wait while it finds answers. It should send an in app
-- notification when complete and an email."
--
-- ⚠ THE EXISTING BAR IS A DURATION AND IT ANSWERS THE WRONG QUESTION. It was set
-- at 90s against a measured median of 73s, on the premise that "a fast answer is
-- one you are still looking at". That premise is now explicitly false — the
-- intent is to walk away from EVERY question. Measured today: 40 of 72 answers
-- (56%) came back under 90 seconds, so the majority of answers notified nobody
-- the moment the asker left the dock.
--
-- Whether somebody was watching is a FACT the client and the connection both
-- know, so it no longer has to be guessed from a clock.
-- ============================================================================

alter table agent_messages
  add column if not exists seen_at timestamptz;

comment on column agent_messages.seen_at is
  'When the asker actually laid eyes on this answer — set by the dock while it is open and the tab visible. NULL on an assistant row means it is still waiting to be read, which is what the dock badge counts and what decides whether the answer is emailed.';

-- ⚠ EVERY EXISTING ANSWER IS BACKFILLED AS SEEN. Without this, switching the
-- badge on would announce 72 historical answers as unread, which is the §12
-- failure where a new signal arrives already crying wolf — and a badge nobody
-- believes on day one is one nobody reads on the day it is right.
update agent_messages
   set seen_at = created_at
 where role = 'assistant'
   and seen_at is null;

-- The badge's own query: unread assistant answers, newest first.
create index if not exists agent_messages_unseen_idx
  on agent_messages (conversation_id, created_at desc)
  where role = 'assistant' and seen_at is null;
