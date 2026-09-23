-- Activity-log field tracking for dev_notes.
--
-- Identical to 20260704000006_activity_actor_attribution.sql (the live
-- definition, dumped from pg_proc rather than retyped) with ONE branch added:
-- status / priority / kind changes on `dev_notes` are recorded in
-- field_changes. Every other table's behaviour is byte-for-byte unchanged.
--
-- Why it matters: log_activity() only builds field_changes for tables it names
-- explicitly. A dev note checked off would otherwise log a bare UPDATE with no
-- indication of what moved — an audit row that records that something happened
-- and refuses to say what.

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

    -- Dev notes: track the check-off and triage fields. Without this branch
    -- an UPDATE logs with no field_changes, so the audit trail would record
    -- that a report was touched but never that it went open -> done, which is
    -- the one transition anyone would go looking for.
    IF TG_TABLE_NAME = 'dev_notes' THEN
      IF old.status IS DISTINCT FROM new.status THEN
        _changes := _changes || jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', new.status));
      END IF;
      IF old.priority IS DISTINCT FROM new.priority THEN
        _changes := _changes || jsonb_build_object('priority', jsonb_build_object('old', old.priority, 'new', new.priority));
      END IF;
      IF old.kind IS DISTINCT FROM new.kind THEN
        _changes := _changes || jsonb_build_object('kind', jsonb_build_object('old', old.kind, 'new', new.kind));
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
