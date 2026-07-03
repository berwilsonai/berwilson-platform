-- Tasks can be tagged to an objective (alongside the project/opportunity tags),
-- so day-to-day work traces back to the steering board. Mirrors the
-- opportunity tag pattern (20260627000002); on delete we just clear the tag.

alter table tasks
  add column if not exists objective_id uuid references objectives(id) on delete set null;

create index if not exists idx_tasks_objective on tasks(objective_id);
