-- Org structure / entity architecture chart (/company/structure)
-- The holding-company map: two arms (for-profit C-Corp + 501(c)(3)), the
-- Management Services LLC that employs all personnel, division holding LLCs,
-- and SPVs under each. Every part is editable in the UI, so arms and the
-- management note are rows too (kind 'arm' / 'management'), not hardcoded JSX.
--   org_nodes  — self-referential hierarchy (parent_id null = top level)
--   org_people — free-text people; node_id null = the leadership roster,
--                node_id set = staff allocated to a division/SPV
-- Kind/entity_type/tier/status are plain text + app constants
-- (src/lib/utils/org.ts), no Postgres enums, so vocab can evolve without a
-- migration. People are deliberately NOT linked to team_members/parties — an
-- org allocation is not a task assignee or a contact.

create table if not exists org_nodes (
  id uuid default gen_random_uuid() primary key,
  parent_id uuid references org_nodes(id) on delete cascade,  -- null = top level (arms, management, divisions)
  kind text not null default 'spv',    -- arm | management | division | spv
  name text not null,
  vertical text,                       -- division vertical label (Energy, …)
  entity_type text,                    -- arms: free text ('Wyoming C-Corporation'); divisions/SPVs: series | standalone
  location text,                       -- SPVs
  note text,                           -- arm descriptive line / management-services explanation
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists org_people (
  id uuid default gen_random_uuid() primary key,
  node_id uuid references org_nodes(id) on delete cascade,  -- null = leadership roster
  tier text,                           -- roster only: leadership | director; null for division/SPV staff
  name text,                           -- null for open (unfilled) positions
  role text not null,
  detail text,
  status text not null default 'active',  -- active | open
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_org_nodes_parent on org_nodes(parent_id);
create index if not exists idx_org_people_node on org_people(node_id);

-- updated_at trigger only (reuses update_updated_at from 00006_triggers.sql).
-- NOTE: deliberately NOT attaching log_activity() — it dereferences
-- new.project_id unconditionally (objectives/investors precedent).
create trigger set_updated_at
  before update on org_nodes
  for each row execute function update_updated_at();
create trigger set_updated_at
  before update on org_people
  for each row execute function update_updated_at();

-- RLS — authenticated users get full access (app traffic uses the service
-- role; RLS is defense-in-depth, per CLAUDE.md §8)
alter table org_nodes enable row level security;
create policy "org_nodes_select" on org_nodes for select using (auth.role() = 'authenticated');
create policy "org_nodes_insert" on org_nodes for insert with check (auth.role() = 'authenticated');
create policy "org_nodes_update" on org_nodes for update using (auth.role() = 'authenticated');
create policy "org_nodes_delete" on org_nodes for delete using (auth.role() = 'authenticated');

alter table org_people enable row level security;
create policy "org_people_select" on org_people for select using (auth.role() = 'authenticated');
create policy "org_people_insert" on org_people for insert with check (auth.role() = 'authenticated');
create policy "org_people_update" on org_people for update using (auth.role() = 'authenticated');
create policy "org_people_delete" on org_people for delete using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Seed — carried over verbatim from the prototype chart. Guarded so it only
-- runs against an empty table (safe to re-apply; safe on the paused cloud
-- rollback DB). Division UUIDs are hardcoded literals so SPV inserts can
-- reference their parents.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from org_nodes) then

    -- Arms
    insert into org_nodes (kind, name, entity_type, note, sort_order) values
      ('arm', 'Ber Wilson, Inc.', 'Wyoming C-Corporation',
       'For-profit — operating brand, equity holder, capital raise vehicle', 0),
      ('arm', 'Building Futures', '501(c)(3)',
       'Non-profit — contract & funding eligibility; needs independent governance', 1);

    -- Management services company (the employment/liability-wall note)
    insert into org_nodes (kind, name, note, sort_order) values
      ('management', 'Ber Wilson Management Services, LLC',
       'All personnel are formally employed by Ber Wilson Management Services, LLC. Names on this chart are allocations for reporting, billed to each entity via a management services agreement, so the liability wall between entities stays intact.', 0);

    -- Divisions (holding LLCs)
    insert into org_nodes (id, kind, name, vertical, entity_type, sort_order) values
      ('0e000000-0000-4000-8000-000000000001', 'division', 'Green Wilson Energy Holdings, LLC', 'Energy', 'series', 0),
      ('0e000000-0000-4000-8000-000000000002', 'division', 'Ber Wilson Rail & Infrastructure Holdings, LLC', 'Military Infrastructure', 'series', 1),
      ('0e000000-0000-4000-8000-000000000003', 'division', 'Golden Rock Holdings, LLC', 'Health & Wellness', 'series', 2),
      ('0e000000-0000-4000-8000-000000000004', 'division', 'Ber Wilson Development Holdings, LLC', 'Real Estate Development', 'series', 3);

    -- SPVs
    insert into org_nodes (parent_id, kind, name, entity_type, location, sort_order) values
      ('0e000000-0000-4000-8000-000000000001', 'spv', 'Myton Energy SPV', 'series', 'Myton, UT', 0),
      ('0e000000-0000-4000-8000-000000000001', 'spv', 'Stockton 150MW SPV', 'standalone', 'Stockton, CA', 1),
      ('0e000000-0000-4000-8000-000000000002', 'spv', 'Myton Rail SPV', 'series', 'Myton, UT', 0),
      ('0e000000-0000-4000-8000-000000000002', 'spv', 'Wendover–Ogden Corridor SPV', 'standalone', 'Utah', 1),
      ('0e000000-0000-4000-8000-000000000003', 'spv', 'H2O Cardio SPV', 'series', 'Wasatch Front, UT', 0),
      ('0e000000-0000-4000-8000-000000000004', 'spv', 'Myton Residential/Commercial SPV', 'series', 'Myton, UT', 0),
      ('0e000000-0000-4000-8000-000000000004', 'spv', 'LA 45-Door SPV', 'standalone', 'Los Angeles, CA', 1),
      ('0e000000-0000-4000-8000-000000000004', 'spv', 'Sandpoint SPV', 'standalone', 'Sandpoint, ID', 2);

    -- Leadership roster (node_id null)
    insert into org_people (tier, name, role, detail, sort_order) values
      ('leadership', 'Nancy Thunell', 'Chairwoman / interim CFO',
       'Biz Dev (primary) · Capital · Relationships · CFO function overseen jointly with Tarek', 0),
      ('leadership', 'Eric Tua''one', 'CEO',
       'Biz Dev (primary) · Engineering · Acquisitions · Strategy · Vision', 1),
      ('leadership', 'Richard White', 'Chief of Staff',
       'Biz Dev (primary) · Partner Relations · Talent/Culture', 2),
      ('leadership', 'Tarek "Rick" Nosseir', 'COO',
       'Execution & Delivery (primary) · Operations · Architecture · joint CFO oversight with Nancy', 3),
      ('director', 'Dennis Allen', 'Director, Biz Dev / Capital Raising', null, 0),
      ('director', 'Amy Clark', 'Director, Real Estate', null, 1),
      ('director', 'Brooke', 'Director, Underwriting', null, 2);

    insert into org_people (tier, name, role, detail, status, sort_order) values
      ('director', null, 'Director, Legal & Compliance',
       'Entity formations, securities/capital-raise compliance, non-profit governance, federal contracting compliance', 'open', 3),
      ('director', null, 'Director, Controller / Accounting',
       'Separate books per SPV — the piece that actually preserves the liability wall between entities', 'open', 4),
      ('director', null, 'Director, People Operations',
       'Multi-state employment compliance across the Management Services LLC', 'open', 5);

  end if;
end $$;
