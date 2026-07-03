-- User access: roles + per-project/opportunity grants
-- team_members becomes the app's user table: each row can link to a Supabase
-- auth user and carries a role preset. access_grants scopes project_manager
-- users to specific projects/opportunities (grants on a parent project cascade
-- to children in app code).
--
-- Roles:
--   admin           — everything (Richard, Eric)
--   executive       — Tasks + Objectives, full edit; no deal detail
--   project_manager — granted projects/opportunities + tasks within them
--   member          — own task list only
--
-- Bootstrap rule (app code): until at least one team_member is linked to an
-- auth user, every signed-in user is treated as admin — so this migration is
-- safe to apply before anyone is linked, and pre-link behavior is unchanged.

alter table team_members
  add column if not exists auth_user_id uuid unique,
  add column if not exists email text,
  add column if not exists role text not null default 'member';

alter table team_members
  add constraint team_members_role_check
  check (role in ('admin', 'executive', 'project_manager', 'member'));

-- Existing seeded rows (Richard, Eric) are the executives running the platform.
update team_members set role = 'admin';

comment on column team_members.auth_user_id is 'Supabase auth user this member signs in as. Null = not yet linked (cannot be resolved to a role; treated as member once any row is linked).';
comment on column team_members.role is 'Access preset: admin | executive | project_manager | member. See src/lib/auth/permissions.ts.';

-- ============================================================
-- access_grants — which projects/opportunities a project_manager can touch
-- ============================================================
create table if not exists access_grants (
  id uuid default gen_random_uuid() primary key,
  team_member_id uuid references team_members(id) on delete cascade not null,
  resource_type text not null check (resource_type in ('project', 'opportunity')),
  resource_id uuid not null,
  created_at timestamptz default now(),
  unique (team_member_id, resource_type, resource_id)
);

create index if not exists idx_access_grants_member on access_grants(team_member_id);

comment on table access_grants is 'Project/opportunity scope for project_manager users. A grant on a parent project covers its children (resolved in app code).';

-- RLS — authenticated users get full access (app traffic uses service role;
-- RLS is defense-in-depth, per CLAUDE.md §8)
alter table access_grants enable row level security;
create policy "access_grants_select" on access_grants for select using (auth.role() = 'authenticated');
create policy "access_grants_insert" on access_grants for insert with check (auth.role() = 'authenticated');
create policy "access_grants_update" on access_grants for update using (auth.role() = 'authenticated');
create policy "access_grants_delete" on access_grants for delete using (auth.role() = 'authenticated');
