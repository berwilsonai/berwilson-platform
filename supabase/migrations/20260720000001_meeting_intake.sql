-- Meeting Notes Intake
-- Reuse the email_intake_sessions staging table for meeting-notes intake,
-- discriminated by intake_kind. Legacy rows (all email research/paste sessions)
-- default to 'email', so both Recent lists filter cleanly.

alter table email_intake_sessions
  add column if not exists intake_kind text not null default 'email';

-- Guard the two allowed values without a hard enum (matches the app's
-- plain-text-vocab convention). Drop-and-add so re-runs are safe.
alter table email_intake_sessions
  drop constraint if exists email_intake_sessions_intake_kind_check;
alter table email_intake_sessions
  add constraint email_intake_sessions_intake_kind_check
  check (intake_kind in ('email', 'meeting'));

create index if not exists idx_email_intake_sessions_kind_status
  on email_intake_sessions (intake_kind, status, updated_at desc);
