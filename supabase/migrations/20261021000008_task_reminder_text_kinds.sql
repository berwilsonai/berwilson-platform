-- The task reminder's two messages, in the self-loop ledger's kind constraint.
--
-- Richard, 2026-10-21: Pepper's morning note, morning text, Chat digests and
-- meeting nudges are HELD (src/lib/notify/policy.ts). What replaces them on the
-- text channel is one thing said twice: the tasks due this coming week, sent
-- Monday, and a day-of reminder for a task still not checked off.
--
-- ⚠ TWO KINDS, NOT ONE. They are two different messages with two different
-- reasons to exist and two different idempotency windows (one a week, one a
-- day), and `pepper_outbound_texts` is the ledger that stops the iMessage sweep
-- reading our own outbound text back as a counterparty obligation — so being
-- able to read it BY kind is the point of the column. A value outside the CHECK
-- fails the whole INSERT, and `sendText` refuses to send without the guard row,
-- so the constraint and the TypeScript union in src/lib/provenance/db.ts must
-- move together.
alter table pepper_outbound_texts drop constraint if exists pepper_outbound_texts_kind_check;
alter table pepper_outbound_texts add constraint pepper_outbound_texts_kind_check
  check (kind = any (array[
    'morning', 'week_ahead', 'nudge', 'reply', 'record_alert',
    'task_week', 'task_due_today', 'ad_hoc'
  ]));
