-- Contact roles: one registry, two placements.
--
-- WHY. Asked on 2026-10-21 for "look somebody up by their role", the platform
-- had no answer: `parties` carries full_name/company/title/tags and no role at
-- all, and role lived only on `project_players.role` — free text, 79 DISTINCT
-- STRINGS over 104 rows, most of them a sentence about one moment ("Broker —
-- 4% fee", "Coordinating customized letters of support from VIPs"). Searching
-- the words an executive would actually type returned 0 for "general
-- contractor", 0 for "attorney", 2 for "lender".
--
-- ⚠ AND A GOOD VOCABULARY ALREADY EXISTED AND ONE ROW IN 104 USED IT.
-- `PROJECT_PLAYER_ROLES` in src/lib/utils/constants.ts has held 33 curated
-- values in six groups since the directory was built — Lender, General
-- Contractor (GC), Legal Counsel, Title Company — wired into the "Add Player"
-- modal and NOTHING ELSE. Every automated writer (email sweep, meeting
-- confirm, proposal confirm) passes the model's prose straight through, and the
-- model was never shown the list. §12 warns that a taxonomy written into a
-- prompt is a second schema that drifts; this one was not even in the prompt.
--
-- THE SHAPE. §12: "A CHECK IS A LIST BAKED INTO THE SCHEMA; AN FK POINTS AT
-- ROWS. If the value set grows with the business it is a table — with `on
-- update cascade` and no delete rule." Insurance Broker is an INSERT at
-- /settings/contact-roles, exactly as a line of business is at
-- /settings/lead-categories.
--
-- TWO PLACEMENTS, because they answer two different questions:
--   party_roles             — what somebody is TO US. Survives every project.
--                             This is the lookup that did not exist. Advisor
--                             lives here.
--   project_players.role_key — what somebody is TO THIS DEAL. Already modelled,
--                             now categorised.
-- One vocabulary serves both; no per-row scope flag, because the placement IS
-- the scope and a flag would be complexity with no demonstrated need.

begin;

-- ─── The registry ────────────────────────────────────────────────────────────

create table if not exists contact_roles (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,
  label           text not null,
  role_group      text not null,
  -- Read to the extraction model verbatim, the way lead_categories.routing_rule
  -- is read to lead triage. This is what keeps the taxonomy from being a second
  -- schema: the enumeration the model sees is generated from these rows (§12).
  extraction_hint text,
  sort_order      integer not null default 100,
  active          boolean not null default true,
  -- Code depends on this row by key; settings will not offer to delete it.
  system          boolean not null default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_contact_roles_active on contact_roles (active, sort_order);

-- ─── What somebody is to US ──────────────────────────────────────────────────

create table if not exists party_roles (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references parties (id) on delete cascade,
  -- ON UPDATE CASCADE and deliberately NO delete rule: renaming a role carries
  -- every contact that holds it, and a role somebody holds cannot be deleted —
  -- that is what `active = false` is for. Same contract as leads.route.
  role_key   text not null references contact_roles (key) on update cascade,
  created_at timestamptz default now(),
  unique (party_id, role_key)
);

create index if not exists idx_party_roles_party on party_roles (party_id);
create index if not exists idx_party_roles_key on party_roles (role_key);

-- ─── What somebody is to THIS DEAL ───────────────────────────────────────────

-- Added BESIDE `role` rather than replacing it. The prose is not noise — "Broker
-- — 4% fee" and "Owner of the 5,000-acre Myton site" carry facts no category
-- can hold, and §12 says two sources for one figure get two COLUMNS, not a
-- winner. Here they are not even the same quantity: one is the category, one is
-- the description. It also fails safe — an extraction writing an unrecognised
-- string still lands, merely uncategorised, where an FK on `role` itself would
-- have discarded the whole insert.
alter table project_players
  add column if not exists role_key text references contact_roles (key) on update cascade;

create index if not exists idx_project_players_role_key on project_players (role_key);

-- ─── Retiring the Vendors half of the Directory ──────────────────────────────

-- `entities` holds 5 rows, all category='vendor', and `party_entities` holds 6,
-- all role='employee' — four months of a second place to look that never has
-- the answer (§9 has carried this as debt since July). The TABLE stays: eleven
-- tables point at it, including project_spvs, ownership_interests and the
-- governance registers, for which it is the legal-entity backbone. What retires
-- is the Directory SURFACE, and the five vendor rows move to `parties` as
-- organizations.
--
-- THE ROW IS THE TOMBSTONE (§12). Nothing is deleted: a chunk and six
-- party_entities rows point at these ids, and the pointer is also the undo.
alter table entities
  add column if not exists merged_into_party_id uuid references parties (id) on delete set null,
  add column if not exists merged_at timestamptz;

comment on column entities.merged_into_party_id is
  'Set when this entity was folded into the parties rolodex (2026-10-21). The row is kept because other tables point at it; readers of the vendor list must filter it out.';

commit;
