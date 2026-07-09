-- Interactive project map (/map): hand-placed coordinates + illustrated-marker
-- type. map_geometry holds an optional GeoJSON geometry (e.g. a LineString for
-- a rail corridor) rendered in addition to the point marker.

alter table projects
  add column if not exists latitude double precision
    check (latitude is null or (latitude between -90 and 90)),
  add column if not exists longitude double precision
    check (longitude is null or (longitude between -180 and 180)),
  add column if not exists map_icon text,
  add column if not exists map_geometry jsonb;

create index if not exists idx_projects_placed
  on projects (id) where latitude is not null;
