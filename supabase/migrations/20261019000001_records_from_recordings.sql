-- A recording that names a deal we do not have becomes the record, automatically.
--
-- Richard's direction, 2026-10-19: a call that moves forward should not wait in a
-- queue. §11 is amended the same way the contact rule was amended on 10-15 — the
-- gate is a RULE, not a score, and the created row carries its own undo handle.
--
-- `auto_created_from` is the recording's platform-wide source ref
-- (`voicememo:<id>` / `driveaudio:<id>`), which is the same opaque key
-- `meetings.drive_file_id` already carries. Three jobs in one column:
--
--   1. THE UNDO. "Everything the 10-19 Synetra run made" is one WHERE clause,
--      the way `auto-contact` tags the rows Pepper created in `parties`. Neither
--      table has a `tags` column, and inventing one would mean a second place to
--      look for provenance that `field_provenance` already answers per field.
--   2. IDEMPOTENCY. `unique (auto_created_from, name)` makes a re-run of the
--      same recording unable to make a second copy of the same deal. A plain
--      UNIQUE permits unlimited NULLs, so a human-created record is untouched by
--      it — this is deliberately NOT `nulls not distinct`, which is the shared-
--      children convention and exactly wrong here.
--   3. THE HONEST LABEL. A reader opening a thin new record can see it was read
--      off a recording rather than typed by somebody.
--
-- One recording legitimately produces several records (a broker call names many
-- properties), which is why the constraint carries `name` and not the ref alone.

alter table projects add column if not exists auto_created_from text;
alter table opportunities add column if not exists auto_created_from text;

comment on column projects.auto_created_from is
  'Source ref of the recording this project was created from (voicememo:<id> / driveaudio:<id>). NULL = created by a human. The undo handle for one automatic run.';
comment on column opportunities.auto_created_from is
  'Source ref of the recording this opportunity was created from (voicememo:<id> / driveaudio:<id>). NULL = created by a human. The undo handle for one automatic run.';

alter table projects
  add constraint projects_auto_created_once unique (auto_created_from, name);
alter table opportunities
  add constraint opportunities_auto_created_once unique (auto_created_from, name);

-- The text Pepper sends when she creates one. A new standing message type, so
-- it gets its own kind rather than hiding inside `ad_hoc`: the guard row is what
-- stops the iMessage sweep reading our own outbound text back as a counterparty
-- obligation, and the ledger is worth being able to read by kind.
alter table pepper_outbound_texts drop constraint if exists pepper_outbound_texts_kind_check;
alter table pepper_outbound_texts add constraint pepper_outbound_texts_kind_check
  check (kind = any (array['morning', 'week_ahead', 'nudge', 'reply', 'record_alert', 'ad_hoc']));

-- ⚠ `opportunities` HAD NO AUDIT TRIGGER, and it is the table this change makes
-- autonomously writable. Found by the verification script for the pass above,
-- which asserted the `activity_log` row named Pepper and got an empty set.
--
-- Forty tables carry `log_activity()` — including `projects`, `tasks`,
-- `meetings`, `documents` and `updates` — and the opportunity register was not
-- one of them, so every edit to a pursuit since the table was created has been
-- unattributed. That is a pre-existing hole; it becomes load-bearing here,
-- because §11's whole safety argument for an autonomous CREATE is that it is
-- attributable and reversible, and `auto_created_from` only answers the second.
--
-- The function needs no change: its `project_id` branch falls through to
-- `to_jsonb(new)->>'project_id'`, which is NULL for a table with no such
-- column — checked against the live definition rather than assumed.
--
-- NOT added to `_audited_in_full`: that list is for registers where WHICH FIELD
-- moved is the whole question, and `opportunities.description` now carries
-- recording prose. INSERT and DELETE are fully recorded either way (a DELETE
-- snapshots the whole row into `metadata`, which is how a hard delete stays
-- recoverable); an UPDATE lands as "someone touched this row", exactly as it
-- does on `projects` today.
drop trigger if exists log_opportunities on opportunities;
create trigger log_opportunities
  after insert or delete or update on opportunities
  for each row execute function log_activity();
