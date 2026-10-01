-- The audit trail — the governance tables finally get one.
--
-- ⚠ THE FINDING THAT PROMPTED THIS. log_activity() triggers existed on eleven
-- tables — projects, tasks, documents, milestones, dd_items, compliance_items,
-- financing_structures, updates, review_queue, dev_notes, lead_categories — and
-- on NONE of team_members, org_people, meetings, access_grants, company_profile
-- or certifications. The minute book and the personnel register were the two
-- least-audited tables in the application, which is exactly backwards: a
-- project's value changing is interesting, and a director's signature authority
-- changing is evidence.
--
-- Two changes here.
--
-- 1. log_activity() learns a GENERIC column-by-column diff for the governance
--    tables. Its existing branches name one or two interesting columns per
--    table, which is right for a project and wrong for a resolution, where
--    which field moved is the whole question. The generic diff is gated to a
--    LIST rather than made the default, because documents and updates carry
--    extracted text in the hundreds of kilobytes and diffing those would write
--    both copies into activity_log on every edit.
--
-- 2. Triggers go on all twenty tables. Note what this buys on DELETE: the
--    function already writes to_jsonb(old) into activity_log.metadata, and
--    activity_log has no UPDATE or DELETE policy, so from here a hard delete of
--    a governance row is recoverable from an append-only log. That is the
--    safety net underneath the delete guards, not a replacement for them.

CREATE OR REPLACE FUNCTION public.log_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$

DECLARE
  _actor_email text;
  _changes jsonb;
  _actor_id uuid;
  _actor_type text;
  _headers jsonb;
  _project_id uuid;
  -- Tables whose UPDATEs are diffed GENERICALLY, column by column.
  --
  -- The branches above name one or two interesting columns per table, which is
  -- right for a project (nobody audits a description edit) and wrong for a
  -- governance record, where WHICH FIELD MOVED is the entire question. A
  -- signing limit raised from 250k to unlimited, a separation type changed from
  -- resigned to terminated, a resolution's signature status walked back — each
  -- would otherwise log as "someone touched this row".
  --
  -- Deliberately a LIST and not the default for every table: documents and
  -- updates carry extracted text in the hundreds of kilobytes, and a generic
  -- diff over those would write both versions into activity_log on every edit.
  _audited_in_full text[] := array[
    'personnel', 'personnel_notes', 'personnel_agreements',
    'personnel_offboarding', 'personnel_note_kinds',
    'resolutions', 'org_roles', 'ownership_interests',
    'entity_obligations', 'conflict_disclosures',
    'related_party_transactions', 'policies', 'policy_acknowledgements',
    'team_members', 'org_people', 'org_nodes', 'meetings',
    'access_grants', 'company_profile', 'certifications'
  ];
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

    -- Generic column-by-column diff for the governance tables. Runs only when
    -- the branches above found nothing, so a table with a hand-written branch
    -- keeps exactly the shape it had.
    IF _changes = '{}'::jsonb AND TG_TABLE_NAME = ANY (_audited_in_full) THEN
      SELECT coalesce(
               jsonb_object_agg(
                 key,
                 jsonb_build_object('old', o.value, 'new', n.value)
               ),
               '{}'::jsonb
             )
        INTO _changes
        FROM jsonb_each(to_jsonb(old)) o
        FULL JOIN jsonb_each(to_jsonb(new)) n USING (key)
       WHERE key NOT IN ('updated_at', 'created_at')
         AND o.value IS DISTINCT FROM n.value;
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
$function$;


-- ─── Triggers ────────────────────────────────────────────────────────────────
--
-- Built by loop rather than written out twenty times: a hand-written list is
-- where a table gets missed, and a missed table here is a silent gap in exactly
-- the record that exists to not have gaps.

do $$
declare t text;
begin
  foreach t in array array[
    -- Previously unaudited, which was the finding.
    'team_members', 'org_people', 'org_nodes', 'meetings',
    'access_grants', 'company_profile', 'certifications',
    -- The personnel register.
    'personnel', 'personnel_notes', 'personnel_agreements',
    'personnel_offboarding', 'personnel_note_kinds',
    -- The corporate record.
    'resolutions', 'org_roles', 'ownership_interests',
    -- The compliance register.
    'entity_obligations', 'conflict_disclosures',
    'related_party_transactions', 'policies', 'policy_acknowledgements'
  ]
  loop
    execute format('drop trigger if exists %I on %I', 'log_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function log_activity()',
      'log_' || t, t
    );
  end loop;
end $$;

-- ─── Labels for the activity log reader ──────────────────────────────────────
-- ACTIVITY_TABLE_LABELS in src/lib/utils/constants.ts carries the English for
-- these; /activity would otherwise print raw table names at a reader, which
-- §7 forbids for stored enums and is no better for a table name.
