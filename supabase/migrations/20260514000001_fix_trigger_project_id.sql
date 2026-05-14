-- Add 'manual_task' to update_source enum for manually created tasks
ALTER TYPE update_source ADD VALUE IF NOT EXISTS 'manual_task';

-- Fix: log_activity trigger used direct field access (new.project_id) which fails
-- on the projects table because it has "id" not "project_id".
-- Switch to JSONB-based access which safely returns NULL for missing fields.

CREATE OR REPLACE FUNCTION log_activity()
RETURNS TRIGGER AS $$
DECLARE
  _actor_email text;
  _changes jsonb;
  _actor_id uuid;
  _actor_type text;
BEGIN
  _actor_id := auth.uid();
  _actor_type := 'user';

  -- Try to get actor email from auth.users (best effort)
  IF _actor_id IS NOT NULL THEN
    SELECT email INTO _actor_email FROM auth.users WHERE id = _actor_id;
  END IF;

  -- If no auth context (system/AI calls via service role), mark as system
  IF _actor_id IS NULL THEN
    _actor_type := 'system';
  END IF;

  -- Build field_changes for UPDATE on tracked fields
  _changes := NULL;
  IF TG_OP = 'UPDATE' THEN
    _changes := '{}'::jsonb;

    -- Projects: track value, status, stage changes
    IF TG_TABLE_NAME = 'projects' THEN
      IF old.estimated_value IS DISTINCT FROM new.estimated_value THEN
        _changes := _changes || jsonb_build_object('estimated_value', jsonb_build_object('old', old.estimated_value, 'new', new.estimated_value));
      END IF;
      IF old.status IS DISTINCT FROM new.status THEN
        _changes := _changes || jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', new.status));
      END IF;
      IF old.stage IS DISTINCT FROM new.stage THEN
        _changes := _changes || jsonb_build_object('stage', jsonb_build_object('old', old.stage, 'new', new.stage));
      END IF;
    END IF;

    -- DD items: track severity changes
    IF TG_TABLE_NAME = 'dd_items' THEN
      IF old.severity IS DISTINCT FROM new.severity THEN
        _changes := _changes || jsonb_build_object('severity', jsonb_build_object('old', old.severity, 'new', new.severity));
      END IF;
      IF old.status IS DISTINCT FROM new.status THEN
        _changes := _changes || jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', new.status));
      END IF;
    END IF;

    -- Milestones: track completion
    IF TG_TABLE_NAME = 'milestones' THEN
      IF old.completed_at IS DISTINCT FROM new.completed_at THEN
        _changes := _changes || jsonb_build_object('completed_at', jsonb_build_object('old', old.completed_at, 'new', new.completed_at));
      END IF;
    END IF;

    -- Compliance: track status changes
    IF TG_TABLE_NAME = 'compliance_items' THEN
      IF old.status IS DISTINCT FROM new.status THEN
        _changes := _changes || jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', new.status));
      END IF;
    END IF;

    -- Clear if no tracked fields changed
    IF _changes = '{}'::jsonb THEN
      _changes := NULL;
    END IF;
  END IF;

  INSERT INTO activity_log (actor_id, actor_type, actor_email, action, table_name, record_id, project_id, field_changes, metadata)
  VALUES (
    _actor_id,
    _actor_type,
    _actor_email,
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(new.id, old.id),
    CASE
      WHEN TG_TABLE_NAME = 'projects' AND TG_OP = 'DELETE' THEN NULL
      WHEN TG_TABLE_NAME = 'projects' THEN COALESCE(new.id, old.id)
      ELSE COALESCE(
        (to_jsonb(new)->>'project_id')::uuid,
        (to_jsonb(old)->>'project_id')::uuid
      )
    END,
    _changes,
    CASE TG_OP
      WHEN 'DELETE' THEN to_jsonb(old)
      ELSE NULL
    END
  );
  RETURN COALESCE(new, old);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
