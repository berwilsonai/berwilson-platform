-- saved_views — a named filter set on a list page.
--
-- ⚠ WHY THIS IS A TABLE AND NOT `localStorage`, WHICH IS THE WHOLE POINT.
-- A per-reader saved view was refused once already, with a recorded reason:
-- `ProjectFilters` used to mirror its filters into `localStorage` and replay
-- them on arrival, which made a bare `/projects` render differently for each
-- executive **with no way for the sender of a link to tell**. It was removed
-- deliberately and `url-facets.tsx` still carries the note forbidding its
-- return.
--
-- That objection is about the STORAGE, not the feature. These rows are shared
-- by default — both executives see the same list — and selecting one NAVIGATES
-- to a URL carrying the whole query. So a pasted link shows the recipient
-- exactly what the sender saw, which is strictly better than the remedy the
-- refusal left behind (bookmark the filtered URL), not worse. A bare
-- `/projects` keeps rendering the unfiltered list; nothing is ever replayed.
--
-- ⚠ `query` IS THE URL'S OWN QUERY STRING, STORED VERBATIM — not a parsed
-- structure. The facets a page offers are already declared in one place
-- (`ProjectFilters` and its two siblings feed `UrlFacets`), and a second
-- schema describing the same thing would drift from it silently, which §12
-- names as a taxonomy written twice. Storing the string means a page that
-- gains a facet needs no migration here.
create table if not exists saved_views (
  id uuid primary key default gen_random_uuid(),
  -- The list page it belongs to, as a path: '/projects', '/opportunities'.
  path text not null,
  name text not null,
  -- URL-safe, and what `?view=` carries. Unique PER PATH, so /projects and
  -- /investors may each have an "Active" without colliding.
  slug text not null,
  -- The query string without its leading '?', e.g. 'sector=infrastructure&stage=capture'.
  query text not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_views_slug_per_path unique (path, slug),
  -- A view with no filters is the unfiltered list, which already has a name:
  -- the page itself. Refusing it here stops a "view" that does nothing.
  constraint saved_views_query_not_empty check (length(btrim(query)) > 0),
  constraint saved_views_name_not_empty check (length(btrim(name)) > 0)
);

comment on table saved_views is
  'A named filter set for a list page. Shared by default — selecting one navigates to a URL carrying the whole query, so a link always means the same thing to everyone (see the migration header).';

create index if not exists saved_views_path_idx on saved_views (path, name);

alter table saved_views enable row level security;

drop policy if exists saved_views_read on saved_views;
create policy saved_views_read on saved_views
  for select to authenticated using (true);

grant select on saved_views to authenticated;
grant all on saved_views to service_role;

-- ⚠ `public.update_updated_at`, NOT `update_updated_at_column`. Both names
-- exist on this database and only one of them is ours: the `_column` suffix
-- belongs to `storage`, Supabase's own schema, and is not on the search path
-- here. Naming it unqualified fails with "function does not exist" while
-- `pg_proc` happily shows a row for it.
drop trigger if exists set_updated_at on saved_views;
create trigger set_updated_at
  before update on saved_views
  for each row execute function public.update_updated_at();
