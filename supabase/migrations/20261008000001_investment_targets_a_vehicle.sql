-- An investment targets a VEHICLE, not an entity.
--
-- ⚠ THE DEFECT THIS FIXES. `investments.spv_entity_id` pointed at `entities` —
-- the legal company — while the vehicle a deal is actually held in is a
-- `project_spvs` row. So an investor into "Delta LandCo LLC" could not be
-- connected to the Delta vehicle at all except by inference, and the same LLC
-- reused across two deals made the pointer ambiguous by construction. Worse,
-- `investments` and `project_spv_participants` each carried equity/committed/
-- funded for the same money with nothing naming which was the record.
--
-- THE TWO QUANTITIES ARE NAMED APART RATHER THAN ONE WINNING (CLAUDE.md §12,
-- one quantity one definition):
--   investments                = THE RAISE PIPELINE. Who we are talking to,
--                                what stage, what they have indicated, the
--                                next step. A relationship over time.
--   project_spv_participants   = THE CAP TABLE. Who holds what in the vehicle,
--                                committed and funded. The ledger of record,
--                                and the only thing `resolveBwShare` reads.
-- They join on `investor_id`, they are shown side by side and labelled, and
-- they are never summed.
--
-- `spv_entity_id` is DROPPED rather than deprecated in place: it is a pointer
-- at the wrong level, zero rows use it (verified `select count(*) from
-- investments` = 0 before writing this), and leaving it would restore exactly
-- the two-homes problem this migration exists to end. The vehicle's own
-- `entity_id` is where the legal company belongs, and it is already there.

begin;

-- ── 1. the new target ───────────────────────────────────────────────────────
alter table investments
  add column if not exists spv_id uuid references project_spvs(id) on delete set null;

comment on column investments.spv_id is
  'The vehicle this commitment is into. Reaching the deal goes THROUGH here, '
  'which is why project_id stays null on an spv-targeted row: a vehicle may '
  'belong to an opportunity, and investments has no opportunity_id.';

create index if not exists idx_investments_spv on investments (spv_id)
  where spv_id is not null;

-- ── 2. 'spv' becomes a target kind ──────────────────────────────────────────
--
-- ⚠ ADDING A VALUE TO A DISCRIMINATOR MEANS CHECKING FOR A CHECK CONSTRAINT ON
-- IT (§12, 09-19). `investments_target_check` allowed project|company only, so
-- a 'spv' row would typecheck, deploy, and fail at every INSERT.
--
-- An spv-targeted row sets spv_id and NOTHING ELSE as its target: project_id
-- must be null, because the deal is reached through the vehicle and a second
-- copy of "which deal" is a second definition that can drift.
alter table investments drop constraint if exists investments_target_check;
alter table investments add constraint investments_target_check check (
  (target_kind = 'company' and project_id is null and spv_id is null)
  or (target_kind = 'project' and project_id is not null and spv_id is null)
  or (target_kind = 'spv' and spv_id is not null and project_id is null)
);

-- ── 3. the pointer at the wrong level goes ──────────────────────────────────
alter table investments drop column if exists spv_entity_id;

commit;
