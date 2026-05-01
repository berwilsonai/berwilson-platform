-- 00006_triggers.sql
-- updated_at auto-maintenance triggers and activity_log auto-insert trigger

-- ============================================================
-- FUNCTION: update_updated_at
-- Keeps updated_at current on any row change
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply updated_at trigger to all tables that have the column
create trigger set_updated_at
  before update on parties
  for each row execute function update_updated_at();

create trigger set_updated_at
  before update on projects
  for each row execute function update_updated_at();

create trigger set_updated_at
  before update on financing_structures
  for each row execute function update_updated_at();

create trigger set_updated_at
  before update on compliance_items
  for each row execute function update_updated_at();

-- ============================================================
-- FUNCTION: log_activity
-- Auto-inserts a row into activity_log on insert/update/delete
-- Runs as security definer so it can always write activity_log
-- ============================================================
create or replace function log_activity()
returns trigger as $$
begin
  insert into activity_log (actor_id, actor_type, action, table_name, record_id, project_id, metadata)
  values (
    auth.uid(),
    'user',
    TG_OP,
    TG_TABLE_NAME,
    coalesce(new.id, old.id),
    case
      when TG_TABLE_NAME = 'projects' then coalesce(new.id, old.id)
      when new is not null and new.project_id is not null then new.project_id
      else null
    end,
    case TG_OP
      when 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
      when 'DELETE' then to_jsonb(old)
      else to_jsonb(new)
    end
  );
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

-- Apply activity logging to all tracked tables
create trigger log_projects
  after insert or update or delete on projects
  for each row execute function log_activity();

create trigger log_updates
  after insert or update or delete on updates
  for each row execute function log_activity();

create trigger log_documents
  after insert or update or delete on documents
  for each row execute function log_activity();

create trigger log_milestones
  after insert or update or delete on milestones
  for each row execute function log_activity();

create trigger log_dd_items
  after insert or update or delete on dd_items
  for each row execute function log_activity();

create trigger log_review
  after insert or update or delete on review_queue
  for each row execute function log_activity();

create trigger log_financing
  after insert or update or delete on financing_structures
  for each row execute function log_activity();

create trigger log_compliance
  after insert or update or delete on compliance_items
  for each row execute function log_activity();
