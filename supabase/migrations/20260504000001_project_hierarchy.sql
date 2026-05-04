-- Add parent-child project hierarchy (one level deep)
-- A "program" is a parent project with children (sub-projects).

-- 1. Add parent_project_id column
ALTER TABLE projects
  ADD COLUMN parent_project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

-- 2. Partial index for fast child lookups
CREATE INDEX idx_projects_parent
  ON projects(parent_project_id)
  WHERE parent_project_id IS NOT NULL;

-- 3. Trigger to enforce single-level hierarchy
CREATE OR REPLACE FUNCTION enforce_single_level_hierarchy()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_project_id IS NOT NULL THEN
    -- Reject if the chosen parent is itself a child
    IF EXISTS (
      SELECT 1 FROM projects WHERE id = NEW.parent_project_id AND parent_project_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Cannot nest more than one level: parent is already a child project';
    END IF;

    -- Reject if this project already has children (cannot become a child)
    IF EXISTS (
      SELECT 1 FROM projects WHERE parent_project_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Cannot make a parent project into a child: it already has sub-projects';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_project_hierarchy
  BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION enforce_single_level_hierarchy();
