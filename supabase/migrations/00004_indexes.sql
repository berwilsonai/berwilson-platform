-- 00004_indexes.sql
-- Performance indexes for all key query patterns

create index idx_projects_status on projects(status);
create index idx_projects_sector on projects(sector);
create index idx_projects_stage on projects(stage);
create index idx_updates_project on updates(project_id, created_at desc);
create index idx_updates_review on updates(review_state) where review_state = 'pending';
create index idx_documents_project on documents(project_id);
create index idx_chunks_project on chunks(project_id);
create index idx_chunks_embedding on chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index idx_activity_project on activity_log(project_id, created_at desc);
create index idx_review_pending on review_queue(resolved_at) where resolved_at is null;
create index idx_milestones_project on milestones(project_id, sort_order);
create index idx_dd_project on dd_items(project_id);
create index idx_compliance_project on compliance_items(project_id);
create index idx_players_project on project_players(project_id);
create index idx_players_party on project_players(party_id);
