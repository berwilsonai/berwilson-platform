-- Fix log_activity trigger: actor_type was hardcoded to 'user' even when
-- auth.uid() is null (service-role / admin-client writes). This caused
-- activity entries to display as "Unknown" in the UI instead of "System".
-- Now: 'user' only when auth.uid() is non-null, 'system' otherwise.

create or replace function log_activity()
returns trigger as $$
declare
  v_record_id  uuid;
  v_project_id uuid;
  v_metadata   jsonb;
  v_actor_id   uuid;
  v_actor_type text;
begin
  -- Determine actor
  v_actor_id   := auth.uid();
  v_actor_type := case when v_actor_id is not null then 'user' else 'system' end;

  -- Resolve record_id
  v_record_id := coalesce(
    (to_jsonb(new)->>'id')::uuid,
    (to_jsonb(old)->>'id')::uuid
  );

  -- Resolve project_id: projects table uses its own id; all others store project_id
  if TG_TABLE_NAME = 'projects' then
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
    v_actor_id,
    v_actor_type,
    TG_OP,
    TG_TABLE_NAME,
    v_record_id,
    v_project_id,
    v_metadata
  );

  return coalesce(new, old);
end;
$$ language plpgsql security definer;
