-- Replace ivfflat with HNSW for chunk embeddings.
-- ivfflat with lists=100 needs >1000 rows for good recall; HNSW works at any scale.
-- HNSW also provides better recall and doesn't require probe tuning.

drop index if exists idx_chunks_embedding;

create index idx_chunks_embedding
  on chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
