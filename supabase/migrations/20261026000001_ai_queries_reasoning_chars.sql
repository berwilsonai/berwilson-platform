-- Record what the model's reasoning cost, per call.
--
-- `tokens_out` has always included the reasoning pass, and on the mechanical
-- passes that is 87-98% of it: measured over the 30 days to 2026-10-26,
-- thread-summary averaged 2,486 completion tokens to deliver ~274 tokens of
-- answer, commitments 3,117 to deliver ~96, commitment-chase 2,803 to deliver
-- ~43. Nothing separated the two, so the cost of thinking could only be
-- estimated by dividing the logged answer's character count into the token
-- total — which is how it went unnoticed for four months.
--
-- Nullable with no default on purpose: NULL means "logged before this column
-- existed", which must stay distinguishable from a real zero now that zero is
-- the thing a reasoning-off task is expected to report. A `0` default would
-- retro-date 3,982 rows as having done no thinking, and the before/after
-- comparison this column exists to make would read as already won.
alter table ai_queries add column if not exists reasoning_chars integer;

comment on column ai_queries.reasoning_chars is
  'Characters of reasoning the model produced and the platform discarded. NULL = logged before 2026-10-26. 0 = the task ran with reasoning_effort=none.';
