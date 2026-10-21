-- Retire the Vendors half of the Directory.
--
-- MEASURED FIRST (§12 — the bloat has never once been where the rule assumed).
-- On 2026-10-21 `entities` held 5 rows, all category='vendor', entity_type
-- 'other', none linked to a project; `party_entities` held 6, all
-- role='employee'. Four months of a second place to look that never has the
-- answer — §9 has carried this split as debt since July.
--
-- ⚠ THE TABLE STAYS. Eleven tables point at `entities`, including
-- project_spvs, ownership_interests, related_party_transactions and the
-- governance registers: it is the LEGAL-ENTITY backbone, built and empty, not
-- a vendor list. Only the Directory SURFACE retires, and these five rows move
-- to `parties` as organizations where the role filter can reach them.
--
-- NOTHING IS DELETED. A chunk and six party_entities rows point at these ids,
-- and the pointer is also the undo: clear merged_into_party_id and the row is
-- a vendor again.
--
-- ⚠ TWO OF THE FIVE WERE MISFILED AS VENDORS ALL ALONG, which is its own
-- argument for the merge: "Dino plumbing and HVAC" is our own acquired
-- operating company, which §4 says in writing is NOT a vendor, and "State of
-- Utah Department of Workforce Services" is a state agency. Only three were
-- ever contractors.

begin;

-- ── Two labels that read as people, on a table that holds organizations ──────
-- `parties` is people AND firms (is_organization). Most role labels serve both
-- — Lender, Broker, Architect — but "Agency / Regulator Staff" cannot describe
-- the Department of Workforce Services itself.
update contact_roles
   set label = 'Government Agency / Official'
 where key = 'agency_staff';

-- ── The three that really are contractors ────────────────────────────────────

with new_parties as (
  insert into parties (full_name, is_organization, relationship_notes)
  values
    ('BTR Construction Contracting Inc', true,
     'Moved from the vendors list 2026-10-21 when the Directory was consolidated onto parties.'),
    ('Crunchtime Construction', true,
     'Moved from the vendors list 2026-10-21 when the Directory was consolidated onto parties.'),
    ('Elite', true,
     'Moved from the vendors list 2026-10-21 when the Directory was consolidated onto parties. Role left blank deliberately — likely Elite Solutions, whose commission base is still an open question (§13).')
  returning id, full_name
)
update entities e
   set merged_into_party_id = np.id,
       merged_at = now()
  from new_parties np
 where (e.name = 'BTR construction contracting inc'               and np.full_name = 'BTR Construction Contracting Inc')
    or (e.name = 'Crunchtime construction'                        and np.full_name = 'Crunchtime Construction')
    or (e.name = 'Elite'                                          and np.full_name = 'Elite');

insert into party_roles (party_id, role_key)
select p.id, 'general_contractor'
  from parties p
 where p.full_name in ('BTR Construction Contracting Inc', 'Crunchtime Construction')
on conflict (party_id, role_key) do nothing;

-- ── The state agency ─────────────────────────────────────────────────────────

with new_party as (
  insert into parties (full_name, is_organization, relationship_notes)
  values ('State of Utah Department of Workforce Services', true,
          'Moved from the vendors list 2026-10-21. Filed as a vendor in error — it is a state agency.')
  returning id
)
update entities e
   set merged_into_party_id = (select id from new_party),
       merged_at = now()
 where e.name = 'State of Utah Department of Workforce Services';

insert into party_roles (party_id, role_key)
select id, 'agency_staff' from parties
 where full_name = 'State of Utah Department of Workforce Services'
on conflict (party_id, role_key) do nothing;

-- ── Dino: our own operating company, already in the rolodex ──────────────────
-- A party row already exists ("Dino Plumbing HVAC & Electrical") and was
-- flagged as a PERSON. No role is assigned: §4 says Dino is an internal
-- operating company and not a vendor, and "which role" is Richard's call, not
-- a guess made in a migration.

update parties
   set is_organization = true
 where full_name = 'Dino Plumbing HVAC & Electrical';

update entities e
   set merged_into_party_id = (select id from parties where full_name = 'Dino Plumbing HVAC & Electrical'),
       merged_at = now()
 where e.name = 'Dino plumbing  and HVAC';

commit;
