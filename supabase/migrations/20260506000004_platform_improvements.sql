-- Platform improvements migration
-- 1. Add actor_email to activity_log (cache user emails at write time)
-- 2. Add field_changes JSONB column for change tracking
-- 3. Add risk_scores table for trending
-- 4. Add portfolio_briefs table for cached daily briefs

-- ─── 1. Activity log: cache actor email & track field changes ────────────────

ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS actor_email text,
  ADD COLUMN IF NOT EXISTS field_changes jsonb;

COMMENT ON COLUMN activity_log.actor_email IS 'Cached email of the actor at write time — avoids N+1 auth lookups';
COMMENT ON COLUMN activity_log.field_changes IS 'For UPDATE actions: {"field": {"old": value, "new": value}} on tracked fields';

-- ─── 2. Risk scores table for per-project trending ──────────────────────────

CREATE TABLE IF NOT EXISTS risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  score numeric(4,1) NOT NULL CHECK (score >= 0 AND score <= 100),
  breakdown jsonb NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_risk_scores_project_date ON risk_scores(project_id, computed_at DESC);

COMMENT ON TABLE risk_scores IS 'Daily computed risk score per project for trend analysis';
COMMENT ON COLUMN risk_scores.breakdown IS '{"critical_risks": n, "overdue_milestones": n, "blocker_dd": n, "stale_data_days": n}';

-- ─── 3. Cached portfolio briefs ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portfolio_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_type text NOT NULL CHECK (brief_type IN ('daily', 'project')),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  content text NOT NULL,
  generated_by text NOT NULL DEFAULT 'system',
  model_used text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_portfolio_briefs_type_date ON portfolio_briefs(brief_type, created_at DESC);
CREATE INDEX idx_portfolio_briefs_project ON portfolio_briefs(project_id, created_at DESC) WHERE project_id IS NOT NULL;

COMMENT ON TABLE portfolio_briefs IS 'Cached AI-generated executive briefs (daily portfolio or per-project)';

-- ─── 4. Enhanced log_activity trigger with field_changes & actor_email ────

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
      WHEN TG_TABLE_NAME = 'projects' THEN COALESCE(new.id, old.id)
      WHEN new IS NOT NULL AND new.project_id IS NOT NULL THEN new.project_id
      ELSE NULL
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
