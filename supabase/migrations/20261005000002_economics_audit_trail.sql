-- An audit trail on deal economics: a number changed, and someone changed it.
--
-- WHY THIS IS NEARLY FREE.
-- `log_activity()` already does a generic column-by-column diff, but only for
-- tables named in its `_audited_in_full` array; everything else logs that
-- someone touched a row and nothing about what moved. Adding nine narrow scalar
-- tables to that array and attaching the trigger buys an append-only,
-- actor-attributed history of every input edit —
-- {"discount_rate_pct": {"old": 0.085, "new": 0.09}} — plus a recoverable
-- `to_jsonb(old)` on delete, with no new table and no application code.
--
-- The function itself is patched in the same migration as the array edit. It is
-- 148 lines of per-table branches, so it was derived from `pg_get_functiondef`
-- and edited programmatically rather than retyped: transcribing it by hand to
-- add one array element is a silent-corruption risk across the whole audit
-- trail (CLAUDE.md §12). Two assertions guarded the patch — that the array grew
-- and that `$function$` still appears exactly twice — and `pg_proc` was checked
-- to hold exactly one `log_activity` afterwards, because `create or replace`
-- does not replace an overload.
--
-- WHY TWO OF THE ELEVEN TABLES ARE NOT HERE.
-- `economics_versions` holds wide jsonb snapshots of the whole model. A generic
-- diff over those writes both copies on every touch, which is the exact cost
-- that made `_audited_in_full` a gated list instead of the default.
-- `economics_input_proposals` is written by a machine, and auditing model churn
-- buries the human actions the log exists to record. `commitments` declines the
-- trigger for the same reason, and the same answer applies: the human half of a
-- proposal is on the row itself, in `decided_by` / `decided_at`.

do $$
declare
  t text;
begin
  foreach t in array array[
    'deal_economics', 'economics_capacity_sources', 'economics_buckets',
    'economics_spvs', 'economics_lines', 'economics_line_schedule',
    'economics_provenance', 'economics_benchmarks', 'economics_templates'
  ]
  loop
    execute format('drop trigger if exists log_%s on %I', t, t);
    execute format(
      'create trigger log_%s after insert or update or delete on %I for each row execute function log_activity()',
      t, t
    );
  end loop;
end $$;

-- ⚠ The array edit inside log_activity() is NOT repeated here. Re-running this
-- file attaches the triggers idempotently; the function body is applied from
-- the derived patch in the same session. If this migration is ever replayed
-- against a fresh database, re-derive the patch rather than pasting a copy of
-- the function, which is how two versions of a 148-line audit function start
-- disagreeing.
