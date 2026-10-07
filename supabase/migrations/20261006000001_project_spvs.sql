-- An SPV becomes a record on the project, with the people in it.
--
-- WHAT WAS WRONG. Every development site runs on three or more vehicles — one
-- around Land, one around Energy, one around the Data Center — and each has
-- different participants, different equity splits and its own capital raise.
-- `economics_spvs` recorded none of that: eight columns and ONE ownership
-- number, `bw_ownership_pct`, with everything not Ber Wilson's as unnamed
-- residue. No participant list, no way to total splits to 100%, no capital
-- figure, and no edit path at all — changing a split meant deleting the vehicle
-- and adding it again, which `on delete set null` turned into silently
-- reparenting all its revenue to Ber Wilson at 100%.
--
-- ⚠ WHY THE PARENT MOVES. `economics_spvs.economics_id` was
-- `not null references deal_economics(id) on delete cascade`, so a vehicle could
-- not exist until an economics model had been built, and deleting that model
-- destroyed every vehicle with it. That is the wrong parent for a record
-- carrying a cap table and committed capital. An SPV is a STRUCTURAL fact — the
-- land goes in one LLC, the energy in another — true long before anyone computes
-- a dollar, and it has to survive a model being rebuilt. So the vehicle hangs
-- off the project or the opportunity directly, and `deal_economics` reads it.
--
-- THE SITE IS THE PROJECT, NOT THE SPV. Richard's call: one place is one
-- project — one map pin, one parcel schedule, one Drive folder, one cast, one
-- negotiation — with the vehicles as children of it. Not one project per SPV
-- under a parent: `parent_project_id` is used on 0 of 14 projects, and an SPV is
-- a financing and liability structure rather than a scope of work, so one EPC
-- contract can be earned across two of them.
--
-- ONE TABLE ANSWERS PARTICIPANTS, EQUITY SPLITS AND CAPITAL RAISE, because they
-- are the same ledger: one row per participant carrying its equity %, its
-- capital committed and its capital funded. The vehicle carries a raise TARGET,
-- which is a goal and deliberately not a sum of anything, so it cannot drift
-- from the rows beneath it. A nullable `investor_id` ties a participant to their
-- row in the investor pipeline, which is the seam if named raises and tranche
-- schedules are ever wanted per vehicle.
--
-- NOTHING TO MIGRATE. `deal_economics`, `economics_spvs` and `economics_lines`
-- held 0 rows across all 14 projects when this was written, so the old table is
-- dropped rather than carried and `economics_lines.spv_id` is repointed.

-- ───────────────────────────────────────────────── the vehicles on a deal

create table if not exists project_spvs (
  id uuid primary key default gen_random_uuid(),

  -- Shared-children convention (CLAUDE.md §4). The structure is decided during
  -- a pursuit, so an opportunity must be able to carry vehicles too.
  project_id uuid references projects(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  constraint project_spvs_parent_check check (num_nonnulls(project_id, opportunity_id) = 1),

  label text not null,
  -- Same members as the column this replaces, so `SpvPurpose` in
  -- src/lib/economics/types.ts is unchanged. Land, Energy and Data Center are
  -- the three a deal is offered by default; Housing and Other exist because
  -- "could have more" was the stated requirement.
  purpose text not null default 'other'
    check (purpose in ('land', 'energy', 'data_center', 'housing', 'other')),

  -- The legal entity in the directory, once one exists. Still never created by
  -- the bootstrap: `entities.category` is vendor|partner|contractor and that
  -- table drives the Vendors & Contractors directory, so a row for an unformed
  -- SPV would list "Myton Land LLC" as a company we buy from.
  entity_id uuid references entities(id) on delete set null,

  -- The vehicle in the corporate org chart at /company/structure, when it is in
  -- there. Fifteen SPV nodes existed with no link to any project; this is the
  -- link. Left NULL on a pursuit where nothing has been formed.
  org_node_id uuid references org_nodes(id) on delete set null,
  -- ⚠ A SNAPSHOT, for the reason src/lib/governance/registers.ts snapshots one:
  -- the org chart is a board people drag boxes around on and the FK is
  -- `on delete set null`, so without this the deal loses the NAME of its own
  -- vehicle the moment someone tidies the chart.
  org_node_name text,

  jurisdiction text,

  -- ⚠ NULLABLE, AND NULL IS NOT 100%. Now the FALLBACK, read only when the
  -- vehicle has no participant ledger — so the simple case stays one field and
  -- nobody is forced to build a cap table to say "we own 51%". When there are
  -- participants, the row flagged `is_ber_wilson` is the answer and this is
  -- shown as superseded rather than silently ignored. One quantity, one
  -- definition (CLAUDE.md §12), and the screen names which one it read.
  bw_ownership_pct numeric(6,3)
    check (bw_ownership_pct is null or (bw_ownership_pct >= 0 and bw_ownership_pct <= 100)),

  -- The money this vehicle is trying to raise. A GOAL, never a rollup of the
  -- participants' commitments — a target and a sum are two quantities and
  -- storing the sum here is how they start disagreeing.
  raise_target numeric(18,2),

  -- The provenance ladder, same six rungs as every other figure in the model.
  status text not null default 'planning_assumption'
    check (status in ('planning_assumption', 'benchmark', 'vendor_quoted',
                      'loi_term_sheet', 'contracted', 'validated')),

  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),

  -- ⚠ `nulls not distinct` IS LOAD-BEARING. Exactly one parent column is always
  -- NULL and two NULLs are never equal, so a plain `unique` would enforce
  -- NOTHING and every re-run of the bootstrap would stack another full set
  -- (CLAUDE.md §12, 09-28). `deal_economics` is the precedent.
  constraint project_spvs_label_unique
    unique nulls not distinct (project_id, opportunity_id, label)
);

-- ──────────────────────────────── who is in a vehicle, and for how much

create table if not exists project_spv_participants (
  id uuid primary key default gen_random_uuid(),
  spv_id uuid not null references project_spvs(id) on delete cascade,

  -- The holder, mirroring `ownership_interests` (the executed cap table): the
  -- NAME is always there, and a link to the directory when we have one. A
  -- financing partner is usually a name in an email weeks before they are a
  -- record anywhere.
  holder_name text not null,
  holder_party_id uuid references parties(id) on delete set null,
  holder_entity_id uuid references entities(id) on delete set null,
  -- Set when the participant is already in the capital-raise pipeline. This is
  -- the seam to `raises`/tranches, deliberately not built yet.
  investor_id uuid references investors(id) on delete set null,

  -- ⚠ WHICH ROW IS OURS IS A FLAG, NEVER A NAME MATCH. Matching on a name is
  -- how `bestMatch` resolved the reader himself as a counterparty, and
  -- "Ber Wilson" appears in the names of half the entities in this business.
  -- The partial unique index below allows at most one per vehicle.
  is_ber_wilson boolean not null default false,

  -- A structural position in a deal, not a list that grows with the business,
  -- so a CHECK rather than a registry (CLAUDE.md §12's test).
  role text not null default 'capital_partner'
    check (role in ('sponsor', 'capital_partner', 'land_owner', 'operator',
                    'offtaker', 'service_provider', 'other')),

  -- The same nine members as `ownership_interests.class`, so a row promoted
  -- into the corporate record later keeps its meaning.
  class text not null default 'membership_units'
    check (class in ('membership_units', 'series_interest', 'common', 'preferred',
                     'profits_interest', 'option', 'warrant', 'convertible_note', 'other')),

  -- NULL is "not agreed yet", on every one of these. Absent is not zero
  -- anywhere in this feature: a 0% split and an undecided one are different
  -- facts, and so are $0 committed and nobody having said.
  equity_pct numeric(7,4)
    check (equity_pct is null or (equity_pct >= 0 and equity_pct <= 100)),
  capital_committed numeric(18,2),
  capital_funded numeric(18,2),
  preferred_return_pct numeric(6,3),
  profit_share_pct numeric(7,4)
    check (profit_share_pct is null or (profit_share_pct >= 0 and profit_share_pct <= 100)),

  -- Per PARTICIPANT, because the splits in one vehicle are rarely all at the
  -- same confidence: two signed and one still a conversation is the normal case,
  -- and the vehicle's own status must not launder the weakest of them.
  status text not null default 'planning_assumption'
    check (status in ('planning_assumption', 'benchmark', 'vendor_quoted',
                      'loi_term_sheet', 'contracted', 'validated')),

  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────── repoint and drop

-- `economics_lines.spv_id` named the old table. Both are empty, so this is a
-- rename of the target rather than a data move.
alter table economics_lines drop constraint if exists economics_lines_spv_id_fkey;
alter table economics_lines
  add constraint economics_lines_spv_id_fkey
  foreign key (spv_id) references project_spvs(id) on delete set null;

drop trigger if exists log_economics_spvs on economics_spvs;
drop table if exists economics_spvs;

-- ──────────────────────────────────────────── indexes, RLS and grants

create index if not exists idx_project_spvs_project
  on project_spvs (project_id, sort_order) where project_id is not null;
create index if not exists idx_project_spvs_opportunity
  on project_spvs (opportunity_id, sort_order) where opportunity_id is not null;
create index if not exists idx_project_spvs_org_node
  on project_spvs (org_node_id) where org_node_id is not null;
create index if not exists idx_spv_participants
  on project_spv_participants (spv_id, sort_order);
create index if not exists idx_spv_participants_investor
  on project_spv_participants (investor_id) where investor_id is not null;

-- ⚠ At most ONE Ber Wilson row per vehicle. Two would make "our share" two
-- answers, and the derivation reads the flagged row directly.
create unique index if not exists uniq_spv_participants_bw
  on project_spv_participants (spv_id) where is_ber_wilson;

do $$
declare
  t text;
begin
  foreach t in array array['project_spvs', 'project_spv_participants']
  loop
    execute format('drop trigger if exists set_updated_at on %I', t);
    execute format(
      'create trigger set_updated_at before update on %I for each row execute function update_updated_at()',
      t
    );
    execute format('alter table %I enable row level security', t);

    execute format('drop policy if exists "Authenticated users can read %s" on %I', t, t);
    execute format(
      'create policy "Authenticated users can read %s" on %I for select to authenticated using (true)',
      t, t
    );
    execute format('drop policy if exists "Authenticated users can write %s" on %I', t, t);
    execute format(
      'create policy "Authenticated users can write %s" on %I for all to authenticated using (true) with check (true)',
      t, t
    );

    -- Explicit, not inherited. A table created by anything but `postgres`
    -- receives NO api grants and answers 42501 to every PostgREST call while
    -- looking perfectly healthy in psql (CLAUDE.md §12, 09-24).
    execute format('grant select on %I to anon', t);
    execute format('grant all on %I to authenticated, service_role', t);
  end loop;
end $$;
