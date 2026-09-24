-- People Intake — profile a person (or a whole cast) from the mail the
-- platform has already read, review it once, and land them on a deal.
--
-- Two small changes, both of which a new INSERT would otherwise fail on at
-- runtime rather than at build time:
--
--   1. email_intake_sessions.intake_kind carries a CHECK constraint listing
--      the allowed kinds. A people run stages a session exactly as the email
--      and meeting runs do, so 'people' has to be added to that list or every
--      staged run dies on insert. (§12: adding a discriminator value means
--      checking for a CHECK constraint on it.)
--
--   2. contact_aliases' uniqueness lives in `uq_contact_alias` — a UNIQUE
--      INDEX on lower(alias), i.e. an EXPRESSION index. PostgREST's
--      `onConflict: 'alias'` names a column, so Postgres finds no matching
--      constraint and /api/parties/associate has been 500ing on every call:
--        ERROR: there is no unique or exclusion constraint matching the
--               ON CONFLICT specification
--      A UNIQUE CONSTRAINT cannot be declared on an expression, so the fix is
--      a stored, already-lowercased column that a real constraint can sit on.
--      alias_key is maintained by Postgres; nothing writes it directly.

-- ── 1. Allow the people intake kind ─────────────────────────────────────────
alter table email_intake_sessions
  drop constraint if exists email_intake_sessions_intake_kind_check;

alter table email_intake_sessions
  add constraint email_intake_sessions_intake_kind_check
  check (intake_kind in ('email', 'meeting', 'people'));

-- ── 2. A conflict target PostgREST can actually name ────────────────────────
alter table contact_aliases
  add column if not exists alias_key text
  generated always as (lower(alias)) stored;

-- Collapse any pre-existing case-variant duplicates before the constraint
-- lands. The expression index above should have prevented them; this is
-- belt-and-braces so the migration cannot fail half-applied.
delete from contact_aliases a
using contact_aliases b
where lower(a.alias) = lower(b.alias)
  and a.ctid > b.ctid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'contact_aliases'::regclass and conname = 'uq_contact_alias_key'
  ) then
    alter table contact_aliases add constraint uq_contact_alias_key unique (alias_key);
  end if;
end $$;

-- The expression index is now redundant with the constraint's own index.
drop index if exists uq_contact_alias;
