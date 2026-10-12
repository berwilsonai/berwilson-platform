-- What the field said before she changed it.
--
-- ⚠ THIS IS WHAT MAKES AN AUTONOMOUS WRITE REVERSIBLE, AND THE FIRST LIVE RUN
-- PROVED IT WAS MISSING. The safety argument for removing the approval gate was
-- "every change is attributable and recoverable from activity_log". Measured
-- immediately after the first real curator pass (17 field writes across 1
-- project, 4 opportunities and 11 parties): activity_log held exactly ONE row.
--
-- Two separate reasons, both pre-existing:
--   - `opportunities` and `parties` carry NO log_activity trigger at all
--     (checked against pg_trigger — projects, milestones and
--     project_spv_participants have one; those two do not). So 15 of 17 writes
--     left no audit row whatsoever.
--   - Even on `projects`, `field_changes` was NULL: the generic column-by-column
--     diff added 09-30 is gated to twenty governance tables, because
--     `documents`/`updates` carry hundreds of KB of text and diffing those
--     would store both copies on every edit (§4). `projects` is not on that list.
--
-- The right fix is NOT to retype log_activity() — §12 is explicit that a
-- 148-line plpgsql function with per-table diff branches must be derived from
-- pg_get_functiondef and edited programmatically, never transcribed, and that
-- is a change to the audit trail of twenty tables to serve one pass. Instead
-- the pass records its own before-value, in the one table it owns. Reversibility
-- then holds by construction for every table the curator can touch, present and
-- future, independent of which tables carry triggers.
--
-- (The trigger gap on `opportunities` and `parties` is real and worth closing on
-- its own merits — it is logged as a finding rather than fixed here, because
-- adding an audit trigger to the contact directory changes the volume of the
-- activity log for every human edit too, and that is a decision rather than a
-- repair.)
alter table record_field_provenance
  add column if not exists previous_value text;

comment on column record_field_provenance.previous_value is
  'The value this field held immediately before Pepper wrote it. NULL means the field was blank. This is the undo.';
