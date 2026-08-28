-- Google Meet transcript import.
--
-- An executive records a meeting in Meet; Google writes the transcript into that
-- organizer's Drive. The importer pulls it in and stages it through the EXISTING
-- meeting-intake path (email_intake_sessions, intake_kind='meeting'), which
-- already runs the AI recap, pre-matches the projects/opportunities it touched,
-- and holds everything for a human confirm. Nothing is created automatically —
-- §11's invariant holds: a recording never becomes a record without review.
--
-- The latch lives here rather than on meetings.drive_file_id because that column
-- marks a durable MEETING RECORD imported from Drive (the board/compliance
-- register), and an internal Meet call is not a governance record. Both columns
-- can coexist: this one dedupes imports, that one would dedupe register entries.

alter table email_intake_sessions add column if not exists drive_file_id text;

-- Idempotency, enforced by the database rather than by the importer remembering.
-- Partial so the overwhelming majority of sessions (pasted notes, mail sweeps)
-- are unaffected and can all carry null.
create unique index if not exists email_intake_sessions_drive_file_id_key
  on email_intake_sessions (drive_file_id)
  where drive_file_id is not null;

comment on column email_intake_sessions.drive_file_id is
  'Google Drive file id of the Meet transcript this session was imported from. Null for pasted/swept sessions.';
