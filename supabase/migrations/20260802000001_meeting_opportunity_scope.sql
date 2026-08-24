-- Meetings — add Opportunity as a third scope (alongside company/board and
-- project). An opportunity-scoped meeting names an opportunity the same way a
-- project-scoped one names a project. Attendee links (party_id / team_member_id)
-- ride inside the existing attendees jsonb, so no attendee schema change.
--
-- Follows the meetings template: plain-text scope via CHECK (no enum;
-- src/lib/utils/meetings.ts is the source of truth), FK on delete set null.

-- New target column
alter table meetings add column if not exists opportunity_id uuid references opportunities(id) on delete set null;
create index if not exists idx_meetings_opportunity on meetings(opportunity_id);

-- Allow the new scope value
alter table meetings drop constraint if exists meetings_scope_check;
alter table meetings add constraint meetings_scope_check
  check (scope in ('company', 'project', 'opportunity'));

-- Re-pair scope ↔ target: exactly the matching target is set for each scope.
--   company     → project_id null  AND opportunity_id null
--   project     → project_id set   AND opportunity_id null
--   opportunity → opportunity_id set AND project_id null
alter table meetings drop constraint if exists meetings_scope_project_check;
alter table meetings add constraint meetings_scope_target_check check (
  (scope = 'company'     and project_id is null and opportunity_id is null) or
  (scope = 'project'     and project_id is not null and opportunity_id is null) or
  (scope = 'opportunity' and opportunity_id is not null and project_id is null)
);
