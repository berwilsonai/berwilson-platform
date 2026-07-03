-- Universal RAG coverage
-- 1. Chunks can belong to opportunities (opportunity docs, notes, snapshots,
--    email research reports) so /intel and the agent can search them.
-- 2. Full document text is stored (documents.extracted_text /
--    opportunity_documents.extracted_text) so PDFs are searchable by content,
--    not just their 2-3 sentence AI summary, and re-embedding never needs a
--    second Gemini transcription pass.
-- 3. match_chunks returns the new columns. Arguments are IDENTICAL to the
--    previous version so callers (src/lib/ai/match-chunks.ts) need no change.

-- 1. chunks: opportunity linkage + provenance label
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS opportunity_id uuid
  REFERENCES opportunities(id) ON DELETE CASCADE;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS opportunity_document_id uuid
  REFERENCES opportunity_documents(id) ON DELETE CASCADE;
-- source_type: 'opportunity' | 'opportunity_document' | 'opportunity_note' |
-- 'email_research_report' (older chunks stay NULL — provenance is inferred
-- from which FK column is set, as before)
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS source_type text;
CREATE INDEX IF NOT EXISTS idx_chunks_opportunity ON chunks(opportunity_id) WHERE opportunity_id IS NOT NULL;

-- 2. Relax the source check to allow opportunity-only chunks
ALTER TABLE chunks DROP CONSTRAINT IF EXISTS chunks_source_check;
ALTER TABLE chunks ADD CONSTRAINT chunks_source_check CHECK (
  document_id IS NOT NULL
  OR update_id IS NOT NULL
  OR entity_id IS NOT NULL
  OR party_id IS NOT NULL
  OR opportunity_id IS NOT NULL
);

-- 3. Full-text storage (populated by the Gemini transcription pass at upload,
--    and by the one-time backfill on /intel)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted_text text;
ALTER TABLE opportunity_documents ADD COLUMN IF NOT EXISTS extracted_text text;

-- 4. match_chunks: same 6 arguments, extended return shape.
--    A return-type change requires DROP (CREATE OR REPLACE would error).
DROP FUNCTION IF EXISTS match_chunks(vector, uuid[], timestamptz, int, uuid[], boolean);

CREATE FUNCTION match_chunks(
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
  opportunity_id uuid,
  source_type text,
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
    c.opportunity_id,
    c.source_type,
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
