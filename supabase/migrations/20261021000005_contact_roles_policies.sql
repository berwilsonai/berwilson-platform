-- Triggers, RLS and grants for the contact-role registry.
--
-- ⚠ Kept as its own migration so it is obvious which per-table attributes a new
-- table needs. §12: "A table created by a migration applied as anything but
-- `postgres` gets NO API GRANTS — every call answers 42501. And the same
-- blindness covers every OTHER per-table attribute applied table-by-table,
-- because a trigger is a hand-written enumeration with no registry behind it."
-- `opportunities` carried no log_activity() while 40 siblings did; `investors`
-- and `investments` carried none while their cap-table counterparts did. The
-- verification script for this change lists these two tables against the
-- enumeration rather than assuming they inherited anything.

begin;

-- ─── updated_at ──────────────────────────────────────────────────────────────

drop trigger if exists set_updated_at on contact_roles;
create trigger set_updated_at before update on contact_roles
  for each row execute function update_updated_at();

-- ─── Audit ───────────────────────────────────────────────────────────────────
--
-- Both tables are tracked. `contact_roles` is a registry a human edits by hand,
-- like lead_categories, and `party_roles` is a human asserting what somebody is
-- to the business — exactly the kind of judgement the append-only log exists to
-- keep. §4: a DELETE survives itself, because log_activity() writes
-- to_jsonb(old) into metadata.
--
-- ⚠ Making a table tracked means auditing every write path to it in the SAME
-- change (§12) — five of eight mutating routes on parties/entities were on the
-- plain client on 10-20 and would have filled the new trail with "system".
-- Every writer added in this change uses actorAdminClient().

drop trigger if exists log_contact_roles_activity on contact_roles;
create trigger log_contact_roles_activity after insert or update or delete on contact_roles
  for each row execute function log_activity();

drop trigger if exists log_party_roles_activity on party_roles;
create trigger log_party_roles_activity after insert or update or delete on party_roles
  for each row execute function log_activity();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Defence in depth; the active boundary is middleware (§8). App traffic is
-- service-role and bypasses these.

alter table contact_roles enable row level security;
alter table party_roles enable row level security;

drop policy if exists contact_roles_select on contact_roles;
create policy contact_roles_select on contact_roles for select
  using (auth.role() = 'authenticated');

drop policy if exists party_roles_select on party_roles;
create policy party_roles_select on party_roles for select
  using (auth.role() = 'authenticated');

drop policy if exists party_roles_write on party_roles;
create policy party_roles_write on party_roles for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- Stated rather than inherited, so the table answers through PostgREST whoever
-- applied the migration.

grant select on contact_roles to anon, authenticated, service_role;
grant insert, update, delete on contact_roles to service_role;
grant select, insert, update, delete on party_roles to anon, authenticated, service_role;

commit;
