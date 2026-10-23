-- Remove the deal economics calculator.
--
-- Richard's direction, 2026-10-23: *"Can you completely remove the calculator
-- and the tensorIQ MSPA. I will build this calculator in excel first and then
-- introduce it to the platform. Please remove any remnants related to auto
-- calculation of deal size etc… I still want to populate all of the fields we
-- can but we will add the calculation functionality later."*
--
-- ⚠ MEASURED BEFORE DROPPING, and the measurement is why this is safe to drop
-- rather than keep: `economics_capture_value` was NULL on all 30 projects and
-- opportunities, and `economics_lines` held 0 rows — so the engine had never
-- once produced a figure in production. What the tables held was the 10-22
-- seed: 30 empty `deal_economics` shells, 210 buckets, 26 AI-staged proposals
-- and 8 benchmarks all flagged for review. No human-authored content.
--
-- ⚠ THE APPEND-ONLY HISTORY SURVIVES THE TABLES, WHICH IS THE POINT OF §4.
-- `activity_log` holds 248 rows naming these tables (210 economics_buckets, 30
-- deal_economics, 8 economics_benchmarks) and `table_name` is plain text with
-- no FK, so the rows outlive the tables. ⚠ ALL 248 ARE `INSERT` ROWS WITH NULL
-- `metadata` — §4's "a DELETE survives itself" writes `to_jsonb(old)`, and
-- nothing was ever deleted from these tables, so the history records that the
-- seed happened and NOT what any row contained. The `drop table` below is
-- therefore a real loss of the row contents, which is the measurement at the
-- top of this file: 30 empty shells, 210 buckets, 8 unverified benchmarks and
-- 26 AI-staged proposals whose source quotes are still in the documents they
-- were read from. ACTIVITY_TABLE_LABELS in src/lib/utils/constants.ts keeps a
-- label for those three table names so /activity does not print raw schema at
-- a reader.
--
-- A deal's value is now `estimated_value` — whatever a human typed — read
-- through `pipelineValue()` in src/lib/records/pipeline-value.ts.

begin;

-- ── 1. The computed pipeline figure ─────────────────────────────────────────
--
-- `economics_capture_value` was Ber Wilson NET capture, computed by the engine.
-- With no engine it can only ever be stale, and a stale computed figure
-- outranking a hand-typed one in `pipelineValue()` is worse than not having it.
alter table projects
  drop column if exists economics_capture_value,
  drop column if exists economics_status,
  drop column if exists economics_computed_at;

alter table opportunities
  drop column if exists economics_capture_value,
  drop column if exists economics_status,
  drop column if exists economics_computed_at;

-- ── 2. `log_activity()`'s audit list ────────────────────────────────────────
--
-- ⚠ DERIVED FROM `pg_get_functiondef` AND EDITED PROGRAMMATICALLY, NEVER
-- RETYPED (§12). The function is ~190 lines of per-table branches and a
-- hand-retyped copy is how a branch gets silently dropped. The eight economics
-- names come out of `_audited_in_full`; everything else is untouched.
--
-- Leaving them would be harmless today (the trigger cannot fire on a table that
-- does not exist) but it is a stale enumeration naming tables that are gone,
-- which is the thing §12 says drifts.
do $$
declare
  _def text;
  _old text;
  _new text;
begin
  select pg_get_functiondef(p.oid) into _def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'log_activity' and n.nspname = 'public';

  if _def is null then
    raise notice 'log_activity() not found — nothing to patch';
    return;
  end if;

  _old := '    -- Deal economics, added 2026-10-05. Nine NARROW SCALAR tables, so a generic';
  if position(_old in _def) = 0 then
    raise notice 'log_activity() does not carry the economics block — already patched';
    return;
  end if;

  -- Cut from the start of the economics comment to the end of its name list.
  --
  -- ⚠ NO `n` FLAG. Postgres regex is newline-INSENSITIVE by default, which is
  -- what makes `.*?` span the twelve comment lines; passing 'n' makes `.` stop
  -- at a newline and the pattern silently matches nothing. That is exactly what
  -- happened on the first run of this migration — and the guard below caught
  -- it, which is why the guard is here rather than a bare replace.
  _new := regexp_replace(
    _def,
    '    -- Deal economics, added 2026-10-05\..*?''economics_provenance'', ''economics_benchmarks'', ''economics_templates'',\n',
    '    -- ⚠ THE DEAL ECONOMICS TABLES WERE LISTED HERE AND WERE DROPPED ON' || chr(10) ||
    '    -- 2026-10-23 with the calculator. They are not replaced: `estimated_value`' || chr(10) ||
    '    -- lives on `projects`, which is not on this list because `documents` and' || chr(10) ||
    '    -- `updates` sit beside it carrying hundreds of KB of text.' || chr(10)
  );

  if _new = _def then
    raise exception 'the economics block did not match — refusing to rewrite log_activity() blind';
  end if;

  -- ⚠ `create or replace` OVERLOADS rather than replaces when a signature
  -- changes (§12). The signature is unchanged here — same name, no arguments,
  -- returns trigger — so this genuinely replaces the one definition.
  execute _new;
end $$;

-- ── 3. The ten tables ───────────────────────────────────────────────────────
--
-- Every foreign key into this cluster is internal to it — verified against
-- information_schema before writing this. `economics_lines.spv_id` points OUT
-- at `project_spvs`, which stays: a vehicle is a child of the deal, not of the
-- model, and the Vehicles tab and its participant ledger are untouched.
--
-- ⚠ `cascade` IS DOING REAL WORK AND IS SCOPED. It drops the internal FKs and
-- the audit triggers on these tables. It cannot reach `project_spvs` — dropping
-- a referenced table's referencing table is not a cascade — and the count above
-- (3 vehicles, 3 participants) is asserted again after this migration runs.
drop table if exists economics_input_proposals cascade;
drop table if exists economics_versions cascade;
drop table if exists economics_line_schedule cascade;
drop table if exists economics_provenance cascade;
drop table if exists economics_lines cascade;
drop table if exists economics_buckets cascade;
drop table if exists economics_capacity_sources cascade;
drop table if exists economics_templates cascade;
drop table if exists economics_benchmarks cascade;
drop table if exists deal_economics cascade;

commit;
