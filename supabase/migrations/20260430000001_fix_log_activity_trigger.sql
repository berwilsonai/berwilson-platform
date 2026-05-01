-- Fix log_activity trigger: project_id resolution used field access (new.project_id)
-- which fails on tables where the row type has no project_id column (e.g. projects).
-- Use to_jsonb() extraction instead — returns NULL safely for missing fields.

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
