-- Fix: deleting a project failed platform-wide with
--   'insert or update on table "activity_log" violates foreign key constraint
--    "activity_log_project_id_fkey"'.
--
-- Cause: the project's own DELETE trigger already nulls project_id
-- (20260514000001), but the CASCADE deletes of child rows (documents, updates,
-- tasks, milestones, …) fire THEIR log triggers after the project row is gone —
-- and those inserts still reference the dead project_id, so the FK check on the
-- activity_log INSERT fails and aborts the whole delete.
--
-- Fix: on FK violation, retry the insert with project_id NULL. The audit row is
-- kept (record_id + the full old-row snapshot in metadata still say what was
-- deleted); only the project linkage is dropped — for a project that no longer
-- exists. Everything else is identical to 20260704000006.

CREATE OR REPLACE FUNCTION log_activity()
RETURNS TRIGGER AS $$
DECLARE
  _actor_email text;
  _changes jsonb;
  _actor_id uuid;
  _actor_type text;
  _headers jsonb;
  _project_id uuid;
BEGIN
  _actor_id := auth.uid();

  -- Service-role writes carry the acting user in request headers.
  IF _actor_id IS NULL THEN
    BEGIN
      _headers := nullif(current_setting('request.headers', true), '')::jsonb;
      _actor_id := nullif(_headers->>'x-actor-id', '')::uuid;
      _actor_email := nullif(_headers->>'x-actor-email', '');
    EXCEPTION WHEN OTHERS THEN
      -- Malformed/absent headers (e.g. direct SQL) must never block the write.
      _actor_id := NULL;
      _actor_email := NULL;
    END;
  END IF;

  -- Best-effort email lookup when only the id is known
  IF _actor_id IS NOT NULL AND _actor_email IS NULL THEN
    SELECT email INTO _actor_email FROM auth.users WHERE id = _actor_id;
  END IF;

  _actor_type := CASE WHEN _actor_id IS NOT NULL THEN 'user' ELSE 'system' END;

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

  _project_id := CASE
    WHEN TG_TABLE_NAME = 'projects' AND TG_OP = 'DELETE' THEN NULL
    WHEN TG_TABLE_NAME = 'projects' THEN COALESCE(new.id, old.id)
    ELSE COALESCE(
      (to_jsonb(new)->>'project_id')::uuid,
      (to_jsonb(old)->>'project_id')::uuid
    )
  END;

  BEGIN
    INSERT INTO activity_log (actor_id, actor_type, actor_email, action, table_name, record_id, project_id, field_changes, metadata)
    VALUES (
      _actor_id,
      _actor_type,
      _actor_email,
      TG_OP,
      TG_TABLE_NAME,
      COALESCE(new.id, old.id),
      _project_id,
      _changes,
      CASE TG_OP
        WHEN 'DELETE' THEN to_jsonb(old)
        ELSE NULL
      END
    );
  EXCEPTION WHEN foreign_key_violation THEN
    -- Cascade delete: the referenced project was just deleted in the same
    -- statement. Keep the audit row, drop the dead linkage.
    INSERT INTO activity_log (actor_id, actor_type, actor_email, action, table_name, record_id, project_id, field_changes, metadata)
    VALUES (
      _actor_id,
      _actor_type,
      _actor_email,
      TG_OP,
      TG_TABLE_NAME,
      COALESCE(new.id, old.id),
      NULL,
      _changes,
      CASE TG_OP
        WHEN 'DELETE' THEN to_jsonb(old)
        ELSE NULL
      END
    );
  END;
  RETURN COALESCE(new, old);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
