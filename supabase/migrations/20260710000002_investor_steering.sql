-- Investor steering pass: task tagging + Ber AI (RAG) coverage.
-- 1. Tasks can be tagged to an investor (mirrors the opportunity/objective tags).
-- 2. Chunks can belong to investors so /intel semantic search and the agent's
--    search_knowledge_base find investor relationships and commitments.
-- 3. match_chunks returns investor_id. Arguments are IDENTICAL to the previous
--    version so callers (src/lib/ai/match-chunks.ts) need no change.

-- 1. Task tag
alter table tasks
  add column if not exists investor_id uuid references investors(id) on delete set null;

create index if not exists idx_tasks_investor on tasks(investor_id);

-- 2. Chunk linkage (snapshots are delete-and-replace per investor)
alter table chunks add column if not exists investor_id uuid
  references investors(id) on delete cascade;
create index if not exists idx_chunks_investor on chunks(investor_id) where investor_id is not null;

-- Relax the source check to allow investor-only chunks
alter table chunks drop constraint if exists chunks_source_check;
alter table chunks add constraint chunks_source_check check (
  document_id is not null
  or update_id is not null
  or entity_id is not null
  or party_id is not null
  or opportunity_id is not null
  or investor_id is not null
);

-- 3. match_chunks: same 6 arguments, extended return shape.
--    A return-type change requires DROP (CREATE OR REPLACE would error).
drop function if exists match_chunks(vector, uuid[], timestamptz, int, uuid[], boolean);

create function match_chunks(
  query_embedding vector(768),
  filter_project_ids uuid[] default '{}',
  filter_after timestamptz default null,
  match_count int default 20,
  filter_entity_ids uuid[] default '{}',
  filter_include_company boolean default false
)
returns table (
  id uuid,
  project_id uuid,
  update_id uuid,
  document_id uuid,
  entity_id uuid,
  party_id uuid,
  opportunity_id uuid,
  investor_id uuid,
  source_type text,
  is_company boolean,
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
    c.entity_id,
    c.party_id,
    c.opportunity_id,
    c.investor_id,
    c.source_type,
    c.is_company,
    c.content,
    c.chunk_index,
    c.token_count,
    c.created_at,
    (1 - (c.embedding <=> query_embedding))::float as similarity,
    coalesce(u.confidence, 0.5)::numeric as source_confidence
  from chunks c
  left join updates u on u.id = c.update_id
  where
    (
      array_length(filter_project_ids, 1) is null
      or c.project_id = any(filter_project_ids)
      or (filter_include_company and c.is_company)
    )
    and (array_length(filter_entity_ids, 1) is null or c.entity_id = any(filter_entity_ids))
    and (filter_after is null or c.created_at >= filter_after)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
