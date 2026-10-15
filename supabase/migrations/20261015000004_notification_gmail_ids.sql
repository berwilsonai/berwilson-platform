-- Remember what Pepper sent, so a reply to it can be recognised.
--
-- ⚠ THE PREREQUISITE FOR AN INBOUND DOOR, AND THE REASON IS WHAT MAKES A MAIL
-- "FOR PEPPER". The alternative is a subject convention — "ask: when does
-- Steelton close" — which is something a human has to remember on a phone at
-- 7am, and which anybody else emailing the mailbox can trip by accident. A
-- reply to one of her own messages is unambiguous, structural, and requires
-- nothing to be remembered; it just needs the id of what she sent, which
-- `sendMail` discarded and `notification_log` never stored.
--
-- On `notification_log` rather than a table of its own: a row already exists
-- per send (it is the per-day idempotency guard), so this is two columns on a
-- row that is already being written, not a second ledger to keep in step.
alter table notification_log
  add column if not exists gmail_message_id text,
  add column if not exists gmail_thread_id text;

comment on column notification_log.gmail_thread_id is
  'The Gmail thread Pepper''s message landed in. A reply arriving on this '
  'thread, from an address on the roster, is a question for her.';

-- Looked up BY THREAD on every inbound poll, so it is indexed that way.
-- Partial, because only the email channel ever fills it.
create index if not exists idx_notification_log_gmail_thread
    on notification_log (gmail_thread_id)
 where gmail_thread_id is not null;
