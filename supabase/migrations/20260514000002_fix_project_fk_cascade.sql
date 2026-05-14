-- Fix: activity_log, review_queue, and research_artifacts had project_id FK
-- references without ON DELETE CASCADE/SET NULL, causing project deletion to fail
-- silently whenever those tables had rows referencing the project.
-- Use SET NULL so historical records are preserved but the project can be deleted.

ALTER TABLE activity_log
  DROP CONSTRAINT IF EXISTS activity_log_project_id_fkey,
  ADD CONSTRAINT activity_log_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE review_queue
  DROP CONSTRAINT IF EXISTS review_queue_project_id_fkey,
  ADD CONSTRAINT review_queue_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE research_artifacts
  DROP CONSTRAINT IF EXISTS research_artifacts_project_id_fkey,
  ADD CONSTRAINT research_artifacts_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
