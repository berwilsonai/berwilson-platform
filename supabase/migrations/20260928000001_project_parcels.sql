-- Parcels: the land a project is actually made of.
--
-- WHY THIS IS NOT A DOCUMENT.
-- The Delta rezone arrived as a photographed exhibit sheet — 11 tax parcels,
-- their acreages, and a requested zone change. Filed as an image it would have
-- been storage: OCR'd into a wall of text, embedded, and then answered only by
-- a model reading a table back out of a photograph. CLAUDE.md §12 already
-- records what that costs — handed a 69-row claim schedule the local model
-- answered 62. A parcel count and an acreage total are the two figures an
-- executive repeats out loud in a hearing. They are arithmetic, not judgement,
-- and they belong in columns where a line of SQL is exact at them.
--
-- WHY THE GEOMETRY IS WORTH STORING TOO.
-- The exhibit's own disclaimer names its source: "Millard County / Utah AGRC
-- parcel geometry". That is public data, queryable by the same parcel IDs the
-- sheet prints, so the real footprint can be fetched rather than traced. A
-- project stops being a pin on /map and becomes its actual 929 acres.
--
-- TWO ACREAGE COLUMNS, DELIBERATELY.
-- `acres` is the deal's own figure — what the application, the LOI or the
-- purchase contract asserts. `assessor_acres` is what the county's cadastre
-- says. On the first import of Delta they agree on 10 of 11 parcels and differ
-- on HD-5534-A-1 by 8.31 acres. Collapsing that into one number would mean
-- picking a winner and losing the fact that anyone disagreed, which on a rezone
-- is precisely the fact worth keeping.

create table if not exists project_parcels (
  id uuid primary key default gen_random_uuid(),

  -- Follows the shared-children convention (CLAUDE.md §4): a parcel schedule
  -- belongs to a project OR an opportunity, never both and never neither. Land
  -- is diligenced long before a project exists.
  project_id uuid references projects(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  constraint project_parcels_parent_check check (
    (project_id is not null and opportunity_id is null) or
    (project_id is null and opportunity_id is not null)
  ),

  -- The county's identifier, exactly as the recorder prints it (HD-5534-A-1).
  -- This is the join key to public cadastral data and the one durable handle on
  -- a piece of ground — CLAUDE.md §12: the sender is never the key to which
  -- deal mail belongs to, the PROPERTY is.
  parcel_id text not null,
  -- Short form for a map label, where the county prefix is noise (5534-A-1).
  label text,

  acres numeric(12,2),
  assessor_acres numeric(12,2),

  owner_name text,
  existing_zone text,
  requested_zone text,

  -- subject    — in the application / under contract
  -- adjacent   — carried for context, not part of the deal
  -- excluded   — considered and dropped, kept so the question is not re-asked
  -- acquired   — closed
  status text not null default 'subject'
    check (status in ('subject', 'adjacent', 'excluded', 'acquired')),

  -- GeoJSON Polygon or MultiPolygon, WGS84. Multi is not an edge case here:
  -- a Utah tax parcel split by a highway or a canal is stored as several rings
  -- under one parcel number, and the import dissolves them into one feature.
  geometry jsonb,
  -- Label anchor + fly-to target, computed at import so neither the map nor a
  -- server route has to reduce a polygon at read time.
  centroid_lat double precision,
  centroid_lng double precision,

  -- Where the geometry came from, so a hand-drawn boundary is never mistaken
  -- for the county's. 'utah_agrc' | 'manual' | 'survey'
  geometry_source text,
  geometry_asof date,

  -- Exhibit fill colour, when a sheet colour-codes its parcels and people have
  -- started referring to "the pink one" in correspondence.
  color text,
  notes text,

  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),

  -- One row per parcel per record.
  --
  -- `nulls not distinct` is load-bearing, not tidiness. Exactly one of the two
  -- parent columns is NULL on every row by construction, and under Postgres's
  -- DEFAULT rule two NULLs never equal each other — so a plain unique key here
  -- would consider every re-import a brand new row, never fire ON CONFLICT, and
  -- silently stack a second copy of the whole schedule beside the first. The
  -- constraint would look present and enforce nothing. Caught before the first
  -- import; it is the same shape as the partial-index trap in CLAUDE.md §12.
  unique nulls not distinct (project_id, opportunity_id, parcel_id)
);

create index if not exists idx_project_parcels_project
  on project_parcels (project_id, sort_order) where project_id is not null;
create index if not exists idx_project_parcels_opportunity
  on project_parcels (opportunity_id, sort_order) where opportunity_id is not null;
-- The map's only query: everything that can actually be drawn.
create index if not exists idx_project_parcels_drawable
  on project_parcels (project_id) where geometry is not null;

drop trigger if exists set_updated_at on project_parcels;
create trigger set_updated_at before update on project_parcels
  for each row execute function update_updated_at();

alter table project_parcels enable row level security;

drop policy if exists "Authenticated users can read project_parcels" on project_parcels;
create policy "Authenticated users can read project_parcels" on project_parcels
  for select to authenticated using (true);

drop policy if exists "Authenticated users can write project_parcels" on project_parcels;
create policy "Authenticated users can write project_parcels" on project_parcels
  for all to authenticated using (true) with check (true);

-- Explicit, not inherited. A table created by anything but `postgres` receives
-- no API grants at all and answers 42501 to every PostgREST call while looking
-- perfectly healthy in psql (CLAUDE.md §12, 09-24).
grant select on project_parcels to anon;
grant all on project_parcels to authenticated, service_role;
