-- Team task system
-- A purpose-built task model replacing the old action_items-in-updates JSON.
-- Tasks are manually created, assigned to a lightweight team member, optionally
-- tagged to a project, carry What/Why/How detail, and have a notes feed.
-- Completed tasks are archived (status='done'), not deleted.

-- ============================================================
-- team_members — lightweight assignee list (NOT the parties directory)
-- ============================================================
create table if not exists team_members (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  color text,                       -- avatar tint (one of a small palette)
  active boolean not null default true,
  created_at timestamptz default now()
);

comment on table team_members is 'Internal people tasks can be assigned to. Kept separate from parties (contacts directory) on purpose.';

-- ============================================================
-- tasks
-- ============================================================
create table if not exists tasks (
  id uuid default gen_random_uuid() primary key,
  title text not null,                                                  -- the headline "what"
  what text,                                                            -- detail: what needs to be done
  why text,                                                             -- detail: why it matters
  how text,                                                             -- detail: how to approach it
  assignee_id uuid references team_members(id) on delete set null,
  project_id uuid references projects(id) on delete set null,           -- optional project tag
  due_date date,
  status text not null default 'open',                                  -- 'open' | 'done'
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_tasks_project on tasks(project_id);
create index if not exists idx_tasks_assignee on tasks(assignee_id);
create index if not exists idx_tasks_due on tasks(due_date);

-- ============================================================
-- task_notes — the "updates & general notes" feed at the bottom of a task
-- ============================================================
create table if not exists task_notes (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references tasks(id) on delete cascade not null,
  body text not null,
  author text,
  created_at timestamptz default now()
);

create index if not exists idx_task_notes_task on task_notes(task_id);

-- ============================================================
-- updated_at trigger on tasks (reuses update_updated_at from 00006_triggers.sql)
-- ============================================================
create trigger set_updated_at
  before update on tasks
  for each row execute function update_updated_at();

-- Activity logging (reuses log_activity from 00006_triggers.sql)
create trigger log_tasks
  after insert or update or delete on tasks
  for each row execute function log_activity();

-- ============================================================
-- RLS — authenticated users get full access (app traffic uses service role;
-- RLS is defense-in-depth, per CLAUDE.md §8)
-- ============================================================
alter table team_members enable row level security;
create policy "team_members_select" on team_members for select using (auth.role() = 'authenticated');
create policy "team_members_insert" on team_members for insert with check (auth.role() = 'authenticated');
create policy "team_members_update" on team_members for update using (auth.role() = 'authenticated');
create policy "team_members_delete" on team_members for delete using (auth.role() = 'authenticated');

alter table tasks enable row level security;
create policy "tasks_select" on tasks for select using (auth.role() = 'authenticated');
create policy "tasks_insert" on tasks for insert with check (auth.role() = 'authenticated');
create policy "tasks_update" on tasks for update using (auth.role() = 'authenticated');
create policy "tasks_delete" on tasks for delete using (auth.role() = 'authenticated');

alter table task_notes enable row level security;
create policy "task_notes_select" on task_notes for select using (auth.role() = 'authenticated');
create policy "task_notes_insert" on task_notes for insert with check (auth.role() = 'authenticated');
create policy "task_notes_update" on task_notes for update using (auth.role() = 'authenticated');
create policy "task_notes_delete" on task_notes for delete using (auth.role() = 'authenticated');

-- ============================================================
-- Seed the initial team
-- ============================================================
insert into team_members (name, color) values
  ('Richard', 'indigo'),
  ('Eric', 'emerald')
on conflict do nothing;
