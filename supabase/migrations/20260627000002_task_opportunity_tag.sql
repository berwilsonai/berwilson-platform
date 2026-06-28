-- Tasks can be tagged to an opportunity (in addition to, or instead of, a project).
-- Mirrors the existing optional project_id tag. Opportunities live in their own table
-- (see 20260627000001_opportunities.sql); on delete we just clear the tag.

alter table tasks
  add column if not exists opportunity_id uuid references opportunities(id) on delete set null;

create index if not exists idx_tasks_opportunity on tasks(opportunity_id);
