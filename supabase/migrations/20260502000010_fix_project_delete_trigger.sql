-- Fix log_activity trigger: when a project row is DELETED, storing project_id = deleted_id
-- violates the FK constraint because the project no longer exists. Use NULL instead.
-- Also adds wipe_all_data() RPC for clearing all application data in scripts.

create or replace function log_activity()
returns trigger as $$
declare
  v_record_id uuid;
  v_project_id uuid;
  v_metadata jsonb;
begin
  -- Resolve record_id
  v_record_id := coalesce(
    (to_jsonb(new)->>'id')::uuid,
    (to_jsonb(old)->>'id')::uuid
  );

  -- Resolve project_id:
  -- For DELETE on projects, the project is already gone — store NULL to avoid FK violation
  if TG_TABLE_NAME = 'projects' and TG_OP = 'DELETE' then
    v_project_id := null;
  elsif TG_TABLE_NAME = 'projects' then
    v_project_id := v_record_id;
  else
    v_project_id := coalesce(
      (to_jsonb(new)->>'project_id')::uuid,
      (to_jsonb(old)->>'project_id')::uuid
    );
  end if;

  -- Build metadata
  if TG_OP = 'UPDATE' then
    v_metadata := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
  elsif TG_OP = 'DELETE' then
    v_metadata := to_jsonb(old);
  else
    v_metadata := to_jsonb(new);
  end if;

  insert into activity_log (actor_id, actor_type, action, table_name, record_id, project_id, metadata)
  values (
    auth.uid(),
    'user',
    TG_OP,
    TG_TABLE_NAME,
    v_record_id,
    v_project_id,
    v_metadata
  );

  return coalesce(new, old);
end;
$$ language plpgsql security definer;

-- RPC: wipe all application data (used by scripts/wipe.ts)
-- Uses session_replication_role = replica to bypass triggers during truncation
create or replace function wipe_all_data()
returns void as $$
begin
  set session_replication_role = 'replica';

  truncate table
    chunks,
    processed_emails,
    review_queue,
    activity_log,
    ai_queries,
    research_artifacts,
    updates,
    documents,
    dd_items,
    compliance_items,
    financing_structures,
    milestones,
    project_players,
    entity_projects,
    projects,
    entities,
    parties,
    graph_subscriptions,
    email_tokens
  restart identity cascade;

  set session_replication_role = 'origin';
end;
$$ language plpgsql security definer;
