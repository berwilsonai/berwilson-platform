-- Remove the Vehicles module (Richard, 2026-10-23).
--
-- WHAT WAS MEASURED FIRST. `project_spvs` held 3 rows and
-- `project_spv_participants` 3, all created by scripts/setup-delta-vehicles.mts
-- and setup-delta-cap-tables.mts on 2026-10-08. Every substantive column was
-- NULL on every row — `equity_pct`, `capital_committed`, `capital_funded`,
-- `bw_ownership_pct`, `raise_target`, `org_node_id` — and all three
-- participants were the same Ber Wilson sponsor placeholder. `investments` held
-- 0 rows in total, so the `spv` target and `spv_id` carried nothing either.
-- No human-authored content is lost here, which is the only reason this is a
-- drop rather than a deprecation.
--
-- ⚠ WHAT IS NOT TOUCHED, because it shares the word and not the concept:
--   * `org_nodes.kind = 'spv'` — the CORPORATE org chart at /company/structure.
--     A division's SPV node is the holding structure, not a deal's vehicle.
--   * `entities` — the legal-entity table. `project_spvs.entity_id` pointed at
--     it; eleven other tables still do, including `ownership_interests` and the
--     governance registers.
--   * `company_profile.contract_types` — "contract vehicles" in the pursuit
--     profile, an entirely different sense of the word.

begin;

-- ── 1. `investments` loses the `spv` target ─────────────────────────────────
--
-- ⚠ THE CHECK AND THE COLUMN TRAVEL TOGETHER. `investments_target_check` names
-- `spv_id` in two of its three arms, so dropping the column while the
-- constraint stands fails outright. Drop the constraint, drop the column, then
-- add the narrowed constraint back — the three shapes become two.
--
-- Safe on real data because the table is empty; a NOT VALID/VALIDATE dance
-- would be required otherwise and is deliberately not used, so this migration
-- fails loudly rather than quietly admitting a row it should not.
alter table investments drop constraint if exists investments_target_check;
alter table investments drop column if exists spv_id;
alter table investments add constraint investments_target_check check (
  (target_kind = 'company' and project_id is null)
  or (target_kind = 'project' and project_id is not null)
);

-- ── 2. `log_activity()`'s audit list ────────────────────────────────────────
--
-- ⚠ DERIVED FROM `pg_get_functiondef`, NEVER RETYPED (§12). The function is
-- ~190 lines of per-table branches and retyping it is how a branch gets lost.
-- Only the two table names come out of `_audited_in_full`; everything else is
-- untouched. The triggers themselves go with the tables in step 3.
do $$
declare
  _def text;
  _new text;
begin
  select pg_get_functiondef(p.oid) into _def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'log_activity' and n.nspname = 'public';

  if _def is null then
    raise notice 'log_activity() not found — nothing to patch';
    return;
  end if;

  if position('project_spv_participants' in _def) = 0 then
    raise notice 'log_activity() does not carry the vehicles block — already patched';
    return;
  end if;

  -- ⚠ THE `n` FLAG. Postgres regex is newline-INSENSITIVE by default, so a
  -- bare `.*?` runs past the end of the block. With `n`, `.` stops at a newline
  -- and the pattern must span the lines explicitly — which is what the
  -- alternation below does, matching the whole comment block plus its line.
  _new := regexp_replace(
    _def,
    '    -- The vehicles on a deal and the people in them, added 2026-10-06\.(.|\n)*?''project_spvs'', ''project_spv_participants''\n',
    '    -- ⚠ THE VEHICLES TABLES WERE LISTED HERE AND WERE DROPPED ON' || chr(10) ||
    '    -- 2026-10-23 with the Vehicles module. Nothing replaced them: there is' || chr(10) ||
    '    -- no record of who holds what in a deal any more. The list must not end' || chr(10) ||
    '    -- on a comma, so the entry above it now closes the array.' || chr(10)
  );

  if _new = _def then
    raise exception 'the vehicles block did not match — refusing to rewrite log_activity() blind';
  end if;

  -- ⚠ THE PRECEDING ENTRY NOW ENDS THE ARRAY. `'parties', 'entities',` carried
  -- a trailing comma because the vehicles line followed it. Removing that line
  -- leaves `…, 'entities',  ];` which is a syntax error, so the comma goes too.
  _new := replace(_new, '''parties'', ''entities'',', '''parties'', ''entities''');

  -- ⚠ `create or replace` OVERLOADS rather than replaces when a signature
  -- changes (§12). The signature is unchanged here — same name, no arguments,
  -- returns trigger — so this genuinely replaces the one definition.
  execute _new;
end $$;

-- ── 3. The two tables ───────────────────────────────────────────────────────
--
-- ⚠ `cascade` IS SCOPED AND IS DOING REAL WORK. It drops each table's audit and
-- updated_at triggers and the participants→spvs FK. It cannot reach `entities`,
-- `org_nodes`, `parties` or `investors`: `project_spvs` and
-- `project_spv_participants` REFERENCE those, and dropping a referencing table
-- never touches what it points at. Participants first so the drop order reads
-- the way the data hangs.
drop table if exists project_spv_participants cascade;
drop table if exists project_spvs cascade;

commit;
