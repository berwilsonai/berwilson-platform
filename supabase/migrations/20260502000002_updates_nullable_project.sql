-- Allow updates.project_id to be null for emails that can't be classified to a project.
-- Low-confidence emails get project_id=null and land in the review queue.
alter table updates alter column project_id drop not null;
