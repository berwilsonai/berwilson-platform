-- Evaluation system: track AI quality over time

-- 1. Rating on synthesize queries (thumbs up=1, thumbs down=-1)
alter table public.ai_queries
  add column if not exists rating smallint check (rating in (1, -1));

-- 2. Rating on agent messages
alter table public.agent_messages
  add column if not exists rating smallint check (rating in (1, -1));

-- 3. Edit diff on review_queue: captures AI output vs human correction
--    Shape: { summary?: {ai, human}, action_items?: {ai_count, human_count, changed},
--             waiting_on?: {ai_count, human_count, changed},
--             risks?: {ai_count, human_count, changed},
--             decisions?: {ai_count, human_count, changed} }
alter table public.review_queue
  add column if not exists edit_diff jsonb;
