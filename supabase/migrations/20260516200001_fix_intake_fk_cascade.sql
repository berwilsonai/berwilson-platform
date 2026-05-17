-- Fix: proposal_intake_sessions.confirmed_project_id had no ON DELETE action,
-- causing project deletion to fail when any intake session referenced the project.

ALTER TABLE proposal_intake_sessions
  DROP CONSTRAINT IF EXISTS proposal_intake_sessions_confirmed_project_id_fkey,
  ADD CONSTRAINT proposal_intake_sessions_confirmed_project_id_fkey
    FOREIGN KEY (confirmed_project_id) REFERENCES projects(id) ON DELETE SET NULL;
