-- Handoffs on tasks: "this task is waiting on {person} for {what}, since {date}".
--
-- The board could always say who OWNS a task, never who is BLOCKING it. That
-- made the chief-of-staff job (chasing what people owe each other) a purely
-- human routing exercise. These three columns are written and cleared as a
-- triple by the API; the weekly report groups them into a Handoffs section.

alter table tasks
  add column if not exists waiting_on_id uuid references team_members(id) on delete set null,
  add column if not exists waiting_on_what text,
  add column if not exists waiting_on_since date;

-- The handoffs list is read per-blocker ("what is Eric holding up?").
create index if not exists tasks_waiting_on_id_idx
  on tasks (waiting_on_id)
  where waiting_on_id is not null;

comment on column tasks.waiting_on_id is 'Team member this task is blocked on (they owe the assignee something). Null = not blocked.';
comment on column tasks.waiting_on_what is 'What is owed, in a few words. Set together with waiting_on_id.';
comment on column tasks.waiting_on_since is 'When the block was recorded — the report ages handoffs off this.';
