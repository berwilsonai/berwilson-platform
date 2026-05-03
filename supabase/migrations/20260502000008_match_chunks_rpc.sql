-- match_chunks: vector similarity search with project + date filters.
-- Called by the Phase 3 synthesis pipeline to retrieve relevant context chunks.
-- Returns similarity score and source confidence for re-ranking in TypeScript.
-- security definer so the vector search works regardless of caller's RLS context.

create or replace function match_chunks(
  query_embedding vector(768),
  filter_project_ids uuid[],
  filter_after timestamptz,
  match_count int default 20
)
returns table (
  id uuid,
  project_id uuid,
  update_id uuid,
  document_id uuid,
  content text,
  chunk_index int,
  token_count int,
  created_at timestamptz,
  similarity float,
  source_confidence numeric
)
language sql stable security definer
as $$
  select
    c.id,
    c.project_id,
    c.update_id,
    c.document_id,
    c.content,
    c.chunk_index,
    c.token_count,
    c.created_at,
    -- cosine similarity: 1 minus cosine distance (higher = more similar)
    (1 - (c.embedding <=> query_embedding))::float as similarity,
    -- confidence from the parent update; 0.5 default for document-sourced chunks
    coalesce(u.confidence, 0.5)::numeric as source_confidence
  from chunks c
  left join updates u on u.id = c.update_id
  where
    -- empty array means "all projects" — null check handles both null and '{}'
    (array_length(filter_project_ids, 1) is null or c.project_id = any(filter_project_ids))
    and (filter_after is null or c.created_at >= filter_after)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
