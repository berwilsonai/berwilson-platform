-- An audit trail on the vehicles and their participants.
--
-- WHY IT MATTERS MORE HERE THAN ON MOST TABLES. WHICH FIELD MOVED is the entire
-- question on an equity split. A partner's share walked from 35% to 25%, a
-- status walked back from `contracted` to `planning_assumption`, a capital
-- commitment quietly reduced — each would otherwise log as "someone touched
-- this row", and neither table carries any history of its own. Both are narrow
-- scalar tables, so the generic column-by-column diff is cheap: the cost that
-- made `_audited_in_full` a gated list rather than the default is wide jsonb and
-- extracted document text, and there is none of either here.
--
-- A DELETE also survives itself: `log_activity()` writes `to_jsonb(old)` into
-- `metadata`, so a hard-deleted participant is recoverable from the log. That is
-- the property that makes a cap-table ledger safe to edit in place.
--
-- ⚠ THE `_audited_in_full` EDIT IS NOT IN THIS FILE, DELIBERATELY. The function
-- is 200 lines of per-table branches, and transcribing it by hand to add one
-- array element is a silent-corruption risk across the whole audit trail
-- (CLAUDE.md §12). It was derived from `pg_get_functiondef`, edited
-- programmatically, and applied in the same session, under four assertions:
--
--   * `$function$` appears exactly twice before and after the patch;
--   * the array went 29 -> 30 entries (one removed, two added);
--   * `'economics_spvs'` is gone and both new tables are present;
--   * `pg_proc` holds exactly ONE `log_activity` afterwards, because
--     `create or replace` does not replace an OVERLOAD — and a second signature
--     would answer `function is not unique` to every call.
--
-- A trailing semicolon had to be appended: `pg_get_functiondef` emits none, and
-- without it the apply fails pointing ~190 lines past the real problem.
--
-- Re-running THIS file attaches the triggers idempotently. If it is ever
-- replayed against a fresh database, re-derive the patch rather than pasting a
-- copy of the function, which is how two versions of a 200-line audit function
-- start disagreeing.

do $$
declare
  t text;
begin
  foreach t in array array['project_spvs', 'project_spv_participants']
  loop
    execute format('drop trigger if exists %I on %I', 'log_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function log_activity()',
      'log_' || t, t
    );
  end loop;
end $$;
