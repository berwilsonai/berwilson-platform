-- The raise pipeline had no audit trail, and it is about to become one tap.
--
-- ⚠ FOUND BY VERIFYING THE CONFIRMATION DIALOG, NOT BY READING THE CODE. The
-- investor delete promises "this removes the investor, their investments and
-- their notes" — every word of which is true, proved in a rolled-back
-- transaction. What the same check turned up is that NEITHER `investors` nor
-- `investments` carries `log_activity()`: 42 tables do, and these two never
-- did. So an investor delete left nothing behind at all. §4 is explicit that
-- `activity_log` is append-only and `log_activity()` writes `to_jsonb(old)`
-- into `metadata`, which is the ONLY reason a hard delete in this app is
-- recoverable — and it is what makes a one-tap delete on a list defensible
-- rather than reckless.
--
-- ⚠ AND THE DRIFT HAS A SHAPE WORTH NAMING: THE CAP-TABLE HALF WAS AUDITED AND
-- THE PIPELINE HALF WAS NOT. §4 pairs these deliberately — "`investments` IS
-- THE RAISE PIPELINE AND `project_spv_participants` IS THE CAP TABLE", they
-- join on `investor_id`, and they are shown side by side. `project_spvs` and
-- `project_spv_participants` both got the trigger when they were built on
-- 10-06; `investors`/`investments` predate them by three months and were never
-- revisited. Two tables answering one question, one of them attributable. Same
-- omission as `opportunities`, which went 40-tables-audited-and-not-this-one
-- until 10-19.
--
-- `investor_notes` is deliberately NOT included. It is a comment feed, like
-- `task_notes` and `steel_deal_notes`, and no feed table in this schema is
-- audited (`dev_notes` and `personnel_notes` are a bug tracker and a governance
-- register, not feeds). A note's own text IS the record; there is nothing a
-- diff of it would add.
--
-- A cascade fires the child's trigger too, so deleting an investor now writes
-- one row per investment as well as the investor's own — each independently
-- recoverable, which is the point.

drop trigger if exists log_investors on investors;
create trigger log_investors
  after insert or delete or update on investors
  for each row execute function log_activity();

drop trigger if exists log_investments on investments;
create trigger log_investments
  after insert or delete or update on investments
  for each row execute function log_activity();
