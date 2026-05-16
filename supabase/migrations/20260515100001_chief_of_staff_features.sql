-- Chief of Staff features: project dependencies + stored briefs
-- 2026-05-15

-- ---------------------------------------------------------------------------
-- 1. Project Dependencies — cross-project dependency tracking
-- ---------------------------------------------------------------------------

create table if not exists project_dependencies (
  id uuid primary key default gen_random_uuid(),
  upstream_project_id uuid not null references projects(id) on delete cascade,
  downstream_project_id uuid not null references projects(id) on delete cascade,
  dependency_type text not null default 'blocks',
  description text,
  severity text not null default 'watch'
    check (severity in ('info', 'watch', 'critical', 'blocker')),
  status text not null default 'active'
    check (status in ('active', 'resolved', 'monitoring')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint no_self_dependency check (upstream_project_id != downstream_project_id),
  constraint unique_dependency unique (upstream_project_id, downstream_project_id, dependency_type)
);

-- Index for querying dependencies by project
create index idx_deps_upstream on project_dependencies(upstream_project_id) where status = 'active';
create index idx_deps_downstream on project_dependencies(downstream_project_id) where status = 'active';

-- RLS
alter table project_dependencies enable row level security;

create policy "Authenticated users can read project_dependencies"
  on project_dependencies for select to authenticated using (true);
create policy "Authenticated users can insert project_dependencies"
  on project_dependencies for insert to authenticated with check (true);
create policy "Authenticated users can update project_dependencies"
  on project_dependencies for update to authenticated using (true);
create policy "Authenticated users can delete project_dependencies"
  on project_dependencies for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. Stored Briefs — persist generated briefs for history + cron delivery
-- ---------------------------------------------------------------------------

create table if not exists stored_briefs (
  id uuid primary key default gen_random_uuid(),
  brief_type text not null default 'portfolio'
    check (brief_type in ('portfolio', 'project', 'meeting_prep')),
  project_id uuid references projects(id) on delete set null,
  title text not null,
  content text not null,
  metadata jsonb default '{}'::jsonb,
  model_used text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index idx_briefs_type_date on stored_briefs(brief_type, created_at desc);
create index idx_briefs_project on stored_briefs(project_id) where project_id is not null;

-- RLS
alter table stored_briefs enable row level security;

create policy "Authenticated users can read stored_briefs"
  on stored_briefs for select to authenticated using (true);
create policy "Authenticated users can insert stored_briefs"
  on stored_briefs for insert to authenticated with check (true);
create policy "Authenticated users can delete stored_briefs"
  on stored_briefs for delete to authenticated using (true);
