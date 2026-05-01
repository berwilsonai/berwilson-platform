-- 00005_rls_policies.sql
-- Row Level Security policies for all tables
-- Pattern: authenticated users get full select/insert/update/delete
-- EXCEPTION: activity_log gets select + insert only (append-only audit trail)

-- parties
alter table parties enable row level security;
create policy "parties_select" on parties for select using (auth.role() = 'authenticated');
create policy "parties_insert" on parties for insert with check (auth.role() = 'authenticated');
create policy "parties_update" on parties for update using (auth.role() = 'authenticated');
create policy "parties_delete" on parties for delete using (auth.role() = 'authenticated');

-- entities
alter table entities enable row level security;
create policy "entities_select" on entities for select using (auth.role() = 'authenticated');
create policy "entities_insert" on entities for insert with check (auth.role() = 'authenticated');
create policy "entities_update" on entities for update using (auth.role() = 'authenticated');
create policy "entities_delete" on entities for delete using (auth.role() = 'authenticated');

-- projects
alter table projects enable row level security;
create policy "projects_select" on projects for select using (auth.role() = 'authenticated');
create policy "projects_insert" on projects for insert with check (auth.role() = 'authenticated');
create policy "projects_update" on projects for update using (auth.role() = 'authenticated');
create policy "projects_delete" on projects for delete using (auth.role() = 'authenticated');

-- project_players
alter table project_players enable row level security;
create policy "project_players_select" on project_players for select using (auth.role() = 'authenticated');
create policy "project_players_insert" on project_players for insert with check (auth.role() = 'authenticated');
create policy "project_players_update" on project_players for update using (auth.role() = 'authenticated');
create policy "project_players_delete" on project_players for delete using (auth.role() = 'authenticated');

-- milestones
alter table milestones enable row level security;
create policy "milestones_select" on milestones for select using (auth.role() = 'authenticated');
create policy "milestones_insert" on milestones for insert with check (auth.role() = 'authenticated');
create policy "milestones_update" on milestones for update using (auth.role() = 'authenticated');
create policy "milestones_delete" on milestones for delete using (auth.role() = 'authenticated');

-- documents
alter table documents enable row level security;
create policy "documents_select" on documents for select using (auth.role() = 'authenticated');
create policy "documents_insert" on documents for insert with check (auth.role() = 'authenticated');
create policy "documents_update" on documents for update using (auth.role() = 'authenticated');
create policy "documents_delete" on documents for delete using (auth.role() = 'authenticated');

-- updates
alter table updates enable row level security;
create policy "updates_select" on updates for select using (auth.role() = 'authenticated');
create policy "updates_insert" on updates for insert with check (auth.role() = 'authenticated');
create policy "updates_update" on updates for update using (auth.role() = 'authenticated');
create policy "updates_delete" on updates for delete using (auth.role() = 'authenticated');

-- chunks
alter table chunks enable row level security;
create policy "chunks_select" on chunks for select using (auth.role() = 'authenticated');
create policy "chunks_insert" on chunks for insert with check (auth.role() = 'authenticated');
create policy "chunks_update" on chunks for update using (auth.role() = 'authenticated');
create policy "chunks_delete" on chunks for delete using (auth.role() = 'authenticated');

-- dd_items
alter table dd_items enable row level security;
create policy "dd_items_select" on dd_items for select using (auth.role() = 'authenticated');
create policy "dd_items_insert" on dd_items for insert with check (auth.role() = 'authenticated');
create policy "dd_items_update" on dd_items for update using (auth.role() = 'authenticated');
create policy "dd_items_delete" on dd_items for delete using (auth.role() = 'authenticated');

-- financing_structures
alter table financing_structures enable row level security;
create policy "financing_structures_select" on financing_structures for select using (auth.role() = 'authenticated');
create policy "financing_structures_insert" on financing_structures for insert with check (auth.role() = 'authenticated');
create policy "financing_structures_update" on financing_structures for update using (auth.role() = 'authenticated');
create policy "financing_structures_delete" on financing_structures for delete using (auth.role() = 'authenticated');

-- compliance_items
alter table compliance_items enable row level security;
create policy "compliance_items_select" on compliance_items for select using (auth.role() = 'authenticated');
create policy "compliance_items_insert" on compliance_items for insert with check (auth.role() = 'authenticated');
create policy "compliance_items_update" on compliance_items for update using (auth.role() = 'authenticated');
create policy "compliance_items_delete" on compliance_items for delete using (auth.role() = 'authenticated');

-- entity_projects
alter table entity_projects enable row level security;
create policy "entity_projects_select" on entity_projects for select using (auth.role() = 'authenticated');
create policy "entity_projects_insert" on entity_projects for insert with check (auth.role() = 'authenticated');
create policy "entity_projects_update" on entity_projects for update using (auth.role() = 'authenticated');
create policy "entity_projects_delete" on entity_projects for delete using (auth.role() = 'authenticated');

-- activity_log — APPEND-ONLY: select + insert only, no update or delete ever
alter table activity_log enable row level security;
create policy "activity_log_select" on activity_log for select using (auth.role() = 'authenticated');
create policy "activity_log_insert" on activity_log for insert with check (auth.role() = 'authenticated');

-- review_queue
alter table review_queue enable row level security;
create policy "review_queue_select" on review_queue for select using (auth.role() = 'authenticated');
create policy "review_queue_insert" on review_queue for insert with check (auth.role() = 'authenticated');
create policy "review_queue_update" on review_queue for update using (auth.role() = 'authenticated');
create policy "review_queue_delete" on review_queue for delete using (auth.role() = 'authenticated');

-- ai_queries
alter table ai_queries enable row level security;
create policy "ai_queries_select" on ai_queries for select using (auth.role() = 'authenticated');
create policy "ai_queries_insert" on ai_queries for insert with check (auth.role() = 'authenticated');
create policy "ai_queries_update" on ai_queries for update using (auth.role() = 'authenticated');
create policy "ai_queries_delete" on ai_queries for delete using (auth.role() = 'authenticated');

-- research_artifacts
alter table research_artifacts enable row level security;
create policy "research_artifacts_select" on research_artifacts for select using (auth.role() = 'authenticated');
create policy "research_artifacts_insert" on research_artifacts for insert with check (auth.role() = 'authenticated');
create policy "research_artifacts_update" on research_artifacts for update using (auth.role() = 'authenticated');
create policy "research_artifacts_delete" on research_artifacts for delete using (auth.role() = 'authenticated');
