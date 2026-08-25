-- Lead notifications (2026-08-25)
--
-- The lead queue only helps someone who opens it. A `pursue`-rated invitation
-- with a ten-day bid date sitting unread is the exact failure the module exists
-- to prevent, so a scored lead now pushes itself out by email.
--
-- One column, because the only thing that has to survive a restart is "has
-- this lead already been announced". Without it a daily cron re-sends the same
-- leads every morning until someone acts, which trains the reader to ignore it.
alter table leads add column if not exists notified_at timestamptz;

-- The notifier's hot path: scored, still undecided, never announced.
create index if not exists idx_leads_unnotified
  on leads(score_state, status)
  where notified_at is null;
