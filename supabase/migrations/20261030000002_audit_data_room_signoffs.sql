-- `data_room_signoffs` joins the generic column-by-column audit diff.
--
-- ⚠ WITHOUT IT A RE-SIGN ERASES THE PREVIOUS SIGNER. The table holds one row per
-- section and a re-sign UPDATES it in place, so "Eric signed this off, then
-- Richard re-signed it an hour later" would keep only Richard — and
-- attributability is the entire point of the feature (Richard, 10-30: *"When
-- checked it will log which user checked it off"*). The generic diff in
-- `_audited_in_full` is the mechanism that makes the sequence readable in the
-- append-only log, and the table qualifies on the same test `parties` and the
-- governance registers passed: narrow and scalar. A section key, a uuid, a
-- name, a timestamp, a count and a sha256 — nothing like the hundreds of
-- kilobytes that keep `documents` and `updates` out.
--
-- ⚠ THE BODY BELOW WAS DERIVED FROM `pg_get_functiondef`, NOT RETYPED (§12).
-- This function is ~200 lines of per-table branches and retyping it is how a
-- branch gets silently dropped. The edit was one programmatic insertion into
-- the `_audited_in_full` array, asserted to have changed exactly one thing, and
-- the result diffed before against after.
--
-- ⚠ AND IT IS `create or replace` ON AN UNCHANGED SIGNATURE, which is the only
-- safe case: §12 — `create or replace` does not replace a function whose
-- signature changed, it OVERLOADS it, and a caller can then fall back to the
-- version without your change. Verified after applying: exactly one `log_activity`
-- in `pg_proc`.
--
-- Verified live: an INSERT then an UPDATE on one sign-off produced
-- `signed_off_by_name: {old: "Richard", new: "Eric"}` and
-- `document_count: {old: 12, new: 14}` in `activity_log.field_changes`.

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
    'access_grants', 'company_profile', 'certifications',
    -- The data-room sign-offs, added 2026-10-30. Qualifies on the same test:
    -- narrow and scalar — a section key, a uuid, a name, a timestamp, a count
    -- and a sha256, nothing like the hundreds of kilobytes that keep
    -- `documents` and `updates` out.
    --
    -- ⚠ WITHOUT THIS A RE-SIGN ERASES THE PREVIOUS SIGNER. The table holds one
    -- row per section and a re-sign UPDATES it, so "Eric signed this off, then
    -- Richard re-signed it" would keep only Richard — and the whole point of the
    -- feature is that a sign-off is attributable. The generic diff is what makes
    -- the sequence readable in the append-only log.
    'data_room_signoffs',
    -- The directory, added 2026-10-20 on Richard's call. `parties` is the
    -- rolodex (161 rows) and `entities` the legal companies (5), and both were
    -- among the nine record-like tables carrying no audit trigger at all —
    -- found on 10-20 while verifying that a new delete button's confirmation
    -- told the truth. They qualify for the generic diff on the same test the
    -- economics tables passed: narrow and scalar. Measured first — rows average
    -- 938 bytes with the longest text column at 1,333 characters, nothing like
    -- the hundreds of kilobytes that keep `documents` and `updates` out.
    --
    -- ⚠ `google_contacts_hash` is deliberately NOT excluded, because the
    -- Workspace sync is idempotent on it (`workspace-sync.ts` skips the write
    -- when the hash already matches), so a hash change never appears on its own
    -- — it always travels with the field change that caused it. A column that
    -- churned on every sync would have needed excluding, and checking that was
    -- the point.
    --
    -- What this buys: Pepper creates contacts automatically (§11, 10-15) and
    -- writes onto existing ones, and a human edits the same rows. The diff puts
    -- both in one attributable history — {"phone": {"old": null, "new": "…"}} —
    -- which is the question a rolodex actually raises, and §12 records a leak
    -- where one number was spread across three people.
    'parties', 'entities'
    -- ⚠ THE DEAL ECONOMICS TABLES WERE LISTED HERE AND WERE DROPPED ON
    -- 2026-10-23 with the calculator. They are not replaced: `estimated_value`
    -- lives on `projects`, which is not on this list because `documents` and
    -- `updates` sit beside it carrying hundreds of KB of text.
    -- ⚠ THE VEHICLES TABLES WERE LISTED HERE AND WERE DROPPED ON
    -- 2026-10-23 with the Vehicles module. Nothing replaced them: there is
    -- no record of who holds what in a deal any more. The list must not end
    -- on a comma, so the entry above it now closes the array.
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
