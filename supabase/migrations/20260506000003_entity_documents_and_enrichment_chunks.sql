-- Allow documents to be scoped to entities (vendors) in addition to projects.
-- Allow chunks to reference entities and parties for enrichment data embedding.

-- 1. Make project_id nullable on documents, add entity_id
ALTER TABLE documents ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES entities(id) ON DELETE CASCADE;
ALTER TABLE documents ADD CONSTRAINT documents_scope_check
  CHECK (project_id IS NOT NULL OR entity_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_id) WHERE entity_id IS NOT NULL;

-- 2. Make project_id nullable on chunks, add entity_id and party_id
ALTER TABLE chunks ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES entities(id) ON DELETE CASCADE;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES parties(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chunks_entity ON chunks(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chunks_party ON chunks(party_id) WHERE party_id IS NOT NULL;

-- 3. Relax the chunks source check to allow enrichment-only chunks
ALTER TABLE chunks DROP CONSTRAINT IF EXISTS chunks_source_check;
ALTER TABLE chunks ADD CONSTRAINT chunks_source_check
  CHECK (document_id IS NOT NULL OR update_id IS NOT NULL OR entity_id IS NOT NULL OR party_id IS NOT NULL);

-- 4. Update match_chunks to support entity filtering
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(768),
  filter_project_ids uuid[] DEFAULT '{}',
  filter_after timestamptz DEFAULT NULL,
  match_count int DEFAULT 20,
  filter_entity_ids uuid[] DEFAULT '{}'
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  update_id uuid,
  document_id uuid,
  entity_id uuid,
  party_id uuid,
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
    c.content,
    c.chunk_index,
    c.token_count,
    c.created_at,
    (1 - (c.embedding <=> query_embedding))::float AS similarity,
    coalesce(u.confidence, 0.5)::numeric AS source_confidence
  FROM chunks c
  LEFT JOIN updates u ON u.id = c.update_id
  WHERE
    (array_length(filter_project_ids, 1) IS NULL OR c.project_id = ANY(filter_project_ids))
    AND (array_length(filter_entity_ids, 1) IS NULL OR c.entity_id = ANY(filter_entity_ids))
    AND (filter_after IS NULL OR c.created_at >= filter_after)
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
