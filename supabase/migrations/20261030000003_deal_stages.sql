-- ONE STAGE VOCABULARY FOR BOTH PIPELINES (Richard, 2026-10-30)
--
-- Richard: *"For stages lets put Prospecting, In Discussions, Due Diligence,
-- Contracting, Won, Lost"*.
--
-- Two things were true before this and both were wrong:
--
--   1. `project_stage` held a DEFENCE-CONTRACTING lifecycle — pursuit, capture,
--      bid, award, mobilization, execution, closeout. Four of those seven
--      members had never been used by a single row: measured here, 14 pursuit,
--      7 capture, 1 bid, 1 null. The back half of the enum described work this
--      company tracks on milestones, not a position in a pipeline.
--
--   2. Opportunities ran a NINTH, SEPARATE vocabulary on `opportunities.status`
--      (identified / evaluating / in_discussion / due_diligence / negotiating /
--      agreement / on_hold / closed_won / closed_passed). Two boards, two
--      languages, and a promotion from one to the other had to translate.
--
-- So the type is renamed `deal_stage`, it carries Richard's six, and
-- OPPORTUNITIES GET THE SAME COLUMN. One quantity, one definition (§12).
--
-- ⚠ STAGE NOW OWNS THE OUTCOME, AND `status` IS NARROWED TO SAY SO.
-- `project_status` held active/on_hold/won/lost/closed, so after this migration
-- "did we win it?" would have had two homes that could disagree — the exact
-- failure §12 calls one-quantity-one-definition. `status` becomes a PARKING
-- FLAG (active | on_hold) and nothing else. The outcome is read off `stage`,
-- only. Measured first: 20 active, 3 on_hold, and ZERO won/lost/closed rows on
-- either table, so the narrowing loses no data. The move-then-narrow below is
-- written anyway, because a migration that is only correct for the rows that
-- happen to exist today is a migration nobody can re-run.
--
-- ⚠ AN ENUM MEMBER CANNOT BE DROPPED, so both types are REPLACED rather than
-- edited: new type, mapped cast, old type dropped. A value outside an enum
-- fails the WHOLE query rather than the row (§12), so the CASE below is
-- exhaustive over every member of the old type with no trailing `else` that
-- could quietly land a row on a stage nobody chose.

begin;

-- ─── 1. The new vocabulary ──────────────────────────────────────────────────

create type deal_stage as enum (
  'prospecting', 'in_discussions', 'due_diligence', 'contracting', 'won', 'lost'
);

-- ─── 2. projects.status: capture any outcome BEFORE narrowing ──────────────
--
-- Order matters. `status` is about to lose won/lost/closed, so whatever those
-- rows were saying has to reach `stage` first or it is simply deleted. Zero rows
-- today; written anyway, because a migration that is only correct for the rows
-- that happen to exist is one nobody can re-run against an older dump.
--
-- ⚠ CAPTURED, NOT WRITTEN YET. Neither outcome has an honest predecessor in the
-- old enum — there was never a member meaning "we did not get it", which is
-- part of why this change was needed — so routing them through an old member
-- just to be re-mapped in step 3 would pick a stage nobody chose. The ids are
-- held and the stage is set directly after the cast.

create temporary table _project_outcomes as
  select id, status::text as outcome
    from projects
   where status::text in ('won', 'lost');

-- ─── 3. projects.stage: cast onto the new type ──────────────────────────────

alter table projects alter column stage drop default;

alter table projects
  alter column stage type deal_stage
  using case stage::text
         -- The front half maps to real pipeline positions.
         when 'pursuit'      then 'prospecting'::deal_stage
         when 'capture'      then 'in_discussions'::deal_stage
         -- A SUBMITTED BID IS A LIVE CONVERSATION, NOT PAPER BEING SIGNED.
         -- 'contracting' is the obvious-looking target and it is wrong: a bid
         -- is out, nothing is being negotiated, and reading 1 record as
         -- "Contracting" would overstate it on the board and in every brief.
         when 'bid'          then 'in_discussions'::deal_stage
         when 'award'        then 'contracting'::deal_stage
         -- The back half all describe work on a deal ALREADY WON. Zero rows,
         -- but they collapse honestly: delivery is not a pipeline position.
         when 'mobilization' then 'won'::deal_stage
         when 'execution'    then 'won'::deal_stage
         when 'closeout'     then 'won'::deal_stage
         -- ⚠ NO TRAILING `else`. All seven members of the old type are named
         -- above, so an unmatched value is impossible; a NULL stage falls
         -- through to NULL, which is what it should stay. An `else` here would
         -- silently land a future member on a stage nobody chose.
       end;

alter table projects alter column stage set default 'prospecting'::deal_stage;

update projects p
   set stage = case o.outcome when 'won' then 'won'::deal_stage
                              when 'lost' then 'lost'::deal_stage end
  from _project_outcomes o
 where o.id = p.id;

drop table _project_outcomes;

-- ─── 4. projects.status: narrow to a parking flag ───────────────────────────

create type project_status_new as enum ('active', 'on_hold');

alter table projects alter column status drop default;

alter table projects
  alter column status type project_status_new
  using case status::text
         when 'active'  then 'active'::project_status_new
         when 'on_hold' then 'on_hold'::project_status_new
         -- An outcome reached `stage` in step 2. What is left of the row is
         -- simply "not parked".
         when 'won'     then 'active'::project_status_new
         when 'lost'    then 'active'::project_status_new
         when 'closed'  then 'active'::project_status_new
         -- Every member of the old type is named; a NULL falls through to NULL.
       end;

alter table projects alter column status set default 'active'::project_status_new;

drop type project_status;
alter type project_status_new rename to project_status;

-- ─── 5. opportunities: the same two columns ─────────────────────────────────
--
-- `opportunities.status` was the PIPELINE, as plain text. It becomes `stage` on
-- the shared type, and `status` is reduced to the same parking flag projects
-- carry, so one reader can ask either table the same two questions.

alter table opportunities add column stage deal_stage;

update opportunities
   set stage = case status
                 when 'identified'     then 'prospecting'::deal_stage
                 when 'evaluating'     then 'prospecting'::deal_stage
                 when 'in_discussion'  then 'in_discussions'::deal_stage
                 when 'due_diligence'  then 'due_diligence'::deal_stage
                 when 'negotiating'    then 'contracting'::deal_stage
                 when 'agreement'      then 'contracting'::deal_stage
                 when 'closed_won'     then 'won'::deal_stage
                 when 'closed_passed'  then 'lost'::deal_stage
                 -- Parked says nothing about position, so it keeps the entry
                 -- stage and the parking is recorded in `status` below.
                 when 'on_hold'        then 'prospecting'::deal_stage
                 else 'prospecting'::deal_stage
               end;

alter table opportunities alter column stage set not null;
alter table opportunities alter column stage set default 'prospecting'::deal_stage;

-- `status` keeps its name and its NOT NULL, and changes meaning. Done as an
-- UPDATE + CHECK rather than a cast because it is already text.
alter table opportunities alter column status drop default;

update opportunities
   set status = case when status = 'on_hold' then 'on_hold' else 'active' end;

alter table opportunities alter column status set default 'active';
alter table opportunities
  add constraint opportunities_status_check check (status in ('active', 'on_hold'));

-- ─── 6. Indexes ─────────────────────────────────────────────────────────────
--
-- `idx_opportunities_status` indexed the pipeline and now indexes a two-member
-- flag, which is worth nothing. The stage is what every board groups by.

drop index if exists idx_opportunities_status;
create index idx_opportunities_stage on opportunities (stage);

commit;

-- ─── 7. A deal is always SOMEWHERE ──────────────────────────────────────────
--
-- ⚠ A NULL STAGE WAS INVISIBLE, NOT NEUTRAL. `projects.stage` was nullable and
-- two rows held NULL, so every board coalesced it — `p.stage ?? 'pursuit'` in
-- three places in ProjectsClient alone. That is a default living in the
-- renderers instead of the schema: the card appeared in the first lane while
-- the database said nothing, so the board and a direct query disagreed and
-- neither was wrong. Under the new vocabulary there is no such thing as a deal
-- off the pipeline — Prospecting IS the "we have not started" position — so the
-- column takes the default the renderers were already inventing.

begin;

update projects set stage = 'prospecting'::deal_stage where stage is null;

alter table projects alter column stage set not null;

commit;

-- ─── 8. Drop the old type ───────────────────────────────────────────────────
--
-- ⚠ RENAMING THE COLUMN'S TYPE DOES NOT REMOVE THE OLD ONE. After step 3 no
-- column anywhere used `project_stage`, and it sat there anyway — still holding
-- pursuit/capture/bid/award/mobilization/execution/closeout, still emitted into
-- `database.ts` by gen-types as a live vocabulary. That is the §12 hazard
-- exactly: a dead enumeration beside the real registry, with a generated type
-- advertising it. Anything that cast to it would compile.

drop type if exists project_stage;
