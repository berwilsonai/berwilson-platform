-- Chunking and embedding pipeline setup
-- Switches vector dimension from 1536 → 768 to match Gemini text-embedding-004
-- Adds embedding_status tracking on updates and documents

-- Drop the old embedding column and index (no data yet — stub was empty)
DROP INDEX IF EXISTS idx_chunks_embedding;
ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE chunks ADD COLUMN embedding vector(768);

-- Recreate ivfflat index for 768-dim cosine similarity
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Track embedding pipeline status on source tables
ALTER TABLE updates ADD COLUMN IF NOT EXISTS embedding_status text DEFAULT 'pending';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding_status text DEFAULT 'pending';
