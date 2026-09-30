-- Widen both vector indexes 768 -> 1024 (the embedder's native width).
--
-- text-embedding-qwen3-embedding-0.6b emits 1024 dimensions. The schema was
-- vector(768), so src/lib/ai/local.ts truncated and renormalized every vector,
-- discarding a quarter of it on every chunk AND every query. Matryoshka training
-- makes the leading slice a valid embedding, so nothing was broken — but 256
-- dimensions of real signal were being thrown away on a platform whose whole job
-- is combing through this corpus.
--
-- A vector(768) cannot be cast to vector(1024), and a vector is only meaningful
-- against the model and width that produced it, so the rows MUST go before the
-- type changes. Retrieval is therefore DOWN until the refill completes:
--
--   lms unload qwen/qwen3.6-35b-a3b      -- frees ~25GB; the 639MB embedder gets the box
--   node --experimental-strip-types --import ./deploy/register.mjs \
--        --env-file=.env.local deploy/reembed.mjs
--   zsh deploy/lmstudio-check.sh          -- reload the 35B at the documented settings
--
-- match_chunks and match_thread_chunks both declare `query_embedding vector` with
-- no dimension, so they accept the wider vector unchanged and are NOT recreated.
--
-- Deliberately NOT touched: opportunity_documents.embedding_status. Only
-- document-pipeline.ts settles that column — the embed path never has — so
-- resetting it to 'pending' would strand 45 complete documents as "Indexing…"
-- forever. It describes the document AI pass, not the vector.

-- ---------------------------------------------------------------------------
-- chunks — curated CRM records
-- ---------------------------------------------------------------------------
drop index if exists idx_chunks_embedding;
delete from chunks;
alter table chunks alter column embedding type vector(1024);
create index idx_chunks_embedding on chunks
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

-- ---------------------------------------------------------------------------
-- thread_chunks — the correspondence index
-- ---------------------------------------------------------------------------
drop index if exists idx_thread_chunks_embedding;
delete from thread_chunks;
alter table thread_chunks alter column embedding type vector(1024);
create index idx_thread_chunks_embedding on thread_chunks
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

-- The refill cursor. embedPendingThreads selects on `embedded_at is null`, so
-- this reset IS the re-embed trigger — and it must happen in the same transaction
-- as the delete above, or the table claims every thread is indexed while holding
-- no chunks for any of them.
update email_threads set embedded_at = null where embedded_at is not null;
