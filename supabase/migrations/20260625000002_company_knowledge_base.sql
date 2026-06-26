-- Company knowledge base
-- Store Ber Wilson's own corpus (capability statements, past-performance
-- narratives, credential write-ups, key-personnel resumes, safety record, win
-- themes) as documents → chunks, tagged is_company so they are reachable from
-- EVERY scope. Portfolio-scoped semantic search already returns them (empty
-- project filter = all chunks); project-scoped search now unions them in via
-- filter_include_company so RFP fit-assessment can cite real credentials from
-- inside a project.
--
-- `is_company` mirrors the existing convention on the `media` table.

-- 1. documents: allow company-scoped documents (no project/entity/site/component)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_company boolean NOT NULL DEFAULT false;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_scope_check;
ALTER TABLE documents ADD CONSTRAINT documents_scope_check
  CHECK (
    project_id IS NOT NULL
    OR entity_id IS NOT NULL
    OR site_id IS NOT NULL
    OR component_id IS NOT NULL
    OR is_company
  );

-- 2. chunks: tag company-scoped chunks
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS is_company boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_chunks_company ON chunks(is_company) WHERE is_company;

-- 3. match_chunks: add filter_include_company and return is_company.
--    Drop prior overloads so there's a single canonical signature.
DROP FUNCTION IF EXISTS match_chunks(vector, uuid[], timestamptz, int);
DROP FUNCTION IF EXISTS match_chunks(vector, uuid[], timestamptz, int, uuid[]);

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(768),
  filter_project_ids uuid[] DEFAULT '{}',
  filter_after timestamptz DEFAULT NULL,
  match_count int DEFAULT 20,
  filter_entity_ids uuid[] DEFAULT '{}',
  filter_include_company boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  update_id uuid,
  document_id uuid,
  entity_id uuid,
  party_id uuid,
  is_company boolean,
  content text,
  chunk_index int,
  token_count int,
  created_at timestamptz,
  similarity float,
  source_confidence numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    c.id,
    c.project_id,
    c.update_id,
    c.document_id,
    c.entity_id,
    c.party_id,
    c.is_company,
    c.content,
    c.chunk_index,
    c.token_count,
    c.created_at,
    (1 - (c.embedding <=> query_embedding))::float AS similarity,
    coalesce(u.confidence, 0.5)::numeric AS source_confidence
  FROM chunks c
  LEFT JOIN updates u ON u.id = c.update_id
  WHERE
    (
      array_length(filter_project_ids, 1) IS NULL
      OR c.project_id = ANY(filter_project_ids)
      OR (filter_include_company AND c.is_company)
    )
    AND (array_length(filter_entity_ids, 1) IS NULL OR c.entity_id = ANY(filter_entity_ids))
    AND (filter_after IS NULL OR c.created_at >= filter_after)
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
