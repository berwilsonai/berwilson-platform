-- Ber AI: a question you can walk away from.
--
-- The run ALREADY survives the client leaving — the SSE route never reads
-- `request.signal`, the ReadableStream has no cancel() handler, and runAgent
-- takes no abort signal, so the answer lands in agent_messages whether or not
-- anyone is watching. What was missing is any way for a LATER mount — another
-- tab, a reload, the dock after it remounted on a record boundary — to learn
-- that a question is still being worked on.
--
-- These two columns are written on the USER row, which the route already
-- inserts before the run starts. That row is therefore the natural job record
-- and no new table is needed (CLAUDE.md's golden rule, and the "durable status
-- row" shape the card batch and meeting transcription already use).
--
-- ⚠ LIVENESS IS A CLOCK, NOT THE COLUMN (§12). A run killed by a
-- `launchctl kickstart` — and a deploy IS a kickstart — cannot write either
-- verdict, so `run_state = 'running'` is immortal on its own. Every reader
-- must pair it with `run_started_at > now() - <the agent's time budget>`.
-- A count that has stopped moving is indistinguishable from a quiet inbox.

alter table agent_messages
  add column if not exists run_state text
    check (run_state in ('running', 'answered', 'failed')),
  add column if not exists run_started_at timestamptz;

comment on column agent_messages.run_state is
  'On a USER row only: the state of the agent turn this question started. NULL on every assistant row and on every row predating 2026-10-21. Never read without run_started_at — a kickstart leaves ''running'' behind forever.';

comment on column agent_messages.run_started_at is
  'When the turn began. The clock half of the liveness test: a ''running'' row older than AGENT_TIME_BUDGET_MS is abandoned, not live.';

-- The only query that matters: "is anything still running for this user?",
-- reached through the conversation. Partial, because the live rows are a
-- vanishing fraction of the table and every reader filters on this value.
create index if not exists idx_agent_messages_running
  on agent_messages (conversation_id, run_started_at desc)
  where run_state = 'running';
