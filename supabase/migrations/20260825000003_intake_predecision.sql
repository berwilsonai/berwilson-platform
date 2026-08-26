-- Pre-decided intake sessions (2026-08-25)
--
-- 104 sessions sat pending, the oldest six weeks old, while the local model ran
-- at 6% utilisation. The information to decide mostly existed — 102 already
-- carried a fit assessment — but nothing turned that into an action, so the
-- queue only ever grew.
--
-- This column holds a recommended DISPOSITION per session: create / merge /
-- dismiss, with the model's reason. The human still confirms every record
-- (CLAUDE.md §11 is untouched) — they just confirm a recommendation instead of
-- investigating from scratch.
--
-- Why a separate judgement rather than a threshold on fit_score: a low fit
-- score means "poor PURSUIT", not "not a record". Sampling the backlog found an
-- approved Letter of Intent scored 15 and a live Utah County IDIQ pursuit
-- scored 30. Auto-dismissing on fit would have thrown both away.
alter table email_intake_sessions add column if not exists predecision jsonb;

-- The pre-decide phase's hot path: pending sessions not yet judged.
create index if not exists idx_intake_sessions_predecision
  on email_intake_sessions(status)
  where predecision is null;
