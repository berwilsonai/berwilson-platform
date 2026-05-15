-- Intelligence gap fixes
-- 1. Store mentioned_projects on updates (extracted but previously discarded)
-- 2. Add project_id to ai_queries for per-project query tracking
-- 3. Add site_id to chunks for site-scoped vector search

-- ----------------------------------------------------------------
-- 1. updates.mentioned_projects
-- ----------------------------------------------------------------
ALTER TABLE updates
  ADD COLUMN IF NOT EXISTS mentioned_projects JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ----------------------------------------------------------------
-- 2. ai_queries.project_id
-- ----------------------------------------------------------------
ALTER TABLE ai_queries
  ADD COLUMN IF NOT EXISTS project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_queries_project_id_idx ON ai_queries(project_id);

-- ----------------------------------------------------------------
-- 3. chunks.site_id
-- ----------------------------------------------------------------
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS site_id UUID NULL REFERENCES sites(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS chunks_site_id_idx ON chunks(site_id);
