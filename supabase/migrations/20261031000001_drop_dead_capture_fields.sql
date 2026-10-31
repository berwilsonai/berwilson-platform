-- Drop the three project capture fields Richard asked to be rid of.
--
-- Richard, 2026-10-31: *"On the project level get rid of decision, ntp and
-- substantial completion."* Asked once on 10-30 and read then as "make these
-- easier to set" — they were kept and rendered unconditionally. This is the
-- removal he actually asked for, columns and all.
--
-- MEASURED FIRST, over all 24 projects:
--   ntp_date                      0 non-null
--   substantial_completion_date   0 non-null
--   bid_decision                  22 'undecided', 2 'pursue', 0 'no_bid'
--
-- The two dates had never been filled once in the life of the platform. Ber
-- Wilson tracks delivery on `milestones`, which is a table with a stage and an
-- owner, not two scalars hanging off the deal.
--
-- ⚠ `bid_decision` WAS A SECOND ANSWER TO A QUESTION `deal_stage` OWNS. §4:
-- STAGE OWNS THE OUTCOME, and two fields answering "are we going after this?"
-- is one-quantity-two-definitions. A project in `in_discussions` showing a
-- Decision of "Go / No-Go Pending" is exactly the contradiction that rule
-- exists to prevent, and 22 of 24 read that way. The 2 'pursue' rows say
-- nothing their stage does not already say.
--
-- ⚠ DROPPING A COLUMN BREAKS EVERY `.select()` STRING NAMING IT AND `tsc` SEES
-- NOTHING (§12) — a 42703 fails the WHOLE query, not the column. Grepped
-- before writing this: `src/lib/reports/deals.ts` held
-- `substantial_completion_date` in its PROJECT_COLUMNS literal and would have
-- 42703'd the entire deal-pipeline report. That reader is fixed in the same
-- commit; the drop and its callers must ship together.

alter table projects drop column if exists ntp_date;
alter table projects drop column if exists substantial_completion_date;

-- The CHECK goes with the column it constrains; naming it here is belt and
-- braces, since `drop column` takes the constraint with it.
alter table projects drop constraint if exists projects_bid_decision_check;
alter table projects drop column if exists bid_decision;
