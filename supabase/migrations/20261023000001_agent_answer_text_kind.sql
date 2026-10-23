-- ─────────────────────────────────────────────────────────────────────────────
-- THE ANSWER TO A QUESTION IS TEXTED, NOT ONLY EMAILED.
--
-- Richard, 2026-10-23: "When I ask Ber AI a question, I want it to text the
-- response to me." The text carries the bottom line plus a link; the email
-- keeps the whole answer, because the median assistant message measured that
-- day is 3,046 characters against the 357 that is the longest body this box
-- has ever actually delivered over the carrier gateway.
--
-- `agent_answer` already exists as a POLICY kind (src/lib/notify/policy.ts) and
-- as a notification_log kind; what it has never been is a TEXT kind. The CHECK
-- below mirrors the union in src/lib/provenance/db.ts and must move with it: a
-- value not in the constraint fails the whole INSERT (§12), which here means
-- the self-loop guard row is never written and sendText refuses to send at
-- all — a channel that is silently off, which is the one failure the notify
-- layer exists to prevent. Previous additions: record_alert (20261019000001),
-- task_week and task_due_today (20261021000008), document_ready
-- (20261022000001).
-- ─────────────────────────────────────────────────────────────────────────────

alter table pepper_outbound_texts
  drop constraint if exists pepper_outbound_texts_kind_check;

alter table pepper_outbound_texts
  add constraint pepper_outbound_texts_kind_check check (
    kind in (
      'morning',
      'week_ahead',
      'nudge',
      'reply',
      'record_alert',
      'task_week',
      'task_due_today',
      'document_ready',
      'agent_answer',
      'ad_hoc'
    )
  );
