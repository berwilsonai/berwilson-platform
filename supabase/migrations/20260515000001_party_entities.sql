-- party_entities: many-to-many link between contacts (parties) and companies (entities)
-- Allows a contact to be associated with multiple companies and vice versa.
-- When a contact is created with a company name, the entity is auto-found or auto-created,
-- and a row is inserted here to link them.

create table party_entities (
  id uuid default gen_random_uuid() primary key,
  party_id uuid references parties(id) on delete cascade not null,
  entity_id uuid references entities(id) on delete cascade not null,
  role text,  -- e.g. 'employee', 'owner', 'board_member', 'consultant'
  is_primary boolean default true,  -- is this the contact's primary/current company?
  created_at timestamptz default now(),
  unique(party_id, entity_id)
);

-- Index for lookups from both directions
create index idx_party_entities_party on party_entities(party_id);
create index idx_party_entities_entity on party_entities(entity_id);

-- RLS: same pattern as other tables
alter table party_entities enable row level security;

create policy "Authenticated users can read party_entities"
  on party_entities for select
  to authenticated
  using (true);

create policy "Authenticated users can insert party_entities"
  on party_entities for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update party_entities"
  on party_entities for update
  to authenticated
  using (true);

create policy "Authenticated users can delete party_entities"
  on party_entities for delete
  to authenticated
  using (true);

-- Backfill: link existing contacts to entities where parties.company matches entities.name
-- This is a one-time migration to connect existing data
insert into party_entities (party_id, entity_id, role, is_primary)
select distinct p.id, e.id, 'employee', true
from parties p
join entities e on lower(trim(p.company)) = lower(trim(e.name))
where p.company is not null
  and p.company != ''
  and not p.is_organization
on conflict (party_id, entity_id) do nothing;
