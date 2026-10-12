-- Read an enum's members, so a guard written in TypeScript can be checked
-- against the database rather than against somebody's memory.
--
-- WHY THIS IS WORTH A MIGRATION. src/lib/provenance/fields.ts carries the
-- members of project_sector / project_stage / project_status so that an
-- autonomous write can be refused before it reaches Postgres — §12: a value
-- outside an enum fails the WHOLE query with 22P02 and a NULL row set, so one
-- plausible-but-wrong sector from a model would discard every other field in
-- the same update, silently. A hard-coded list is the right guard and the wrong
-- thing to leave unverified: a member added by a later migration would leave it
-- quietly rejecting a legal value.
--
-- ⚠ ONE SIGNATURE. §12: adding an argument OVERLOADS a function and
-- `create or replace` does not replace it, after which an 8-argument PostgREST
-- call answers `function is not unique`. There is one argument here and there
-- should stay one; if a second is ever needed, DROP this signature in the same
-- migration.
create or replace function enum_members(enum_name text)
returns table (label text)
language sql
stable
security invoker
as $$
  select e.enumlabel::text
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  where t.typname = enum_name
  order by e.enumsortorder
$$;

-- PostgREST reaches it through the API roles.
grant execute on function enum_members(text) to service_role, authenticated, anon;
