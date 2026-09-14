-- Ask the inbox — semantic search over correspondence (2026-09-14)
--
-- The platform reads every email and files it, but could not ANSWER from it.
-- `search_email_threads` keyword-matches subject, deal_name, counterparty,
-- summary and key_facts — never the message body. Measured against live data
-- before this change, using Richard's own example: 15 threads mention Hill AFB
-- in their body, 5 in their subject, and 2 in their AI summary. So two thirds of
-- what he would ask about was unreachable, and a real question's phrasing
-- ("do we need to register?") matches none of those fields at all.
--
-- The site-visit answer was sitting in plain text the whole time: "The sit visit
-- is September 15 @ 9:00 am". The data was there; nothing could retrieve it by
-- meaning.

-- ── 1. thread_chunks — a SEPARATE index, deliberately not `chunks` ──────────
--
-- This is the load-bearing decision of the whole feature.
--
-- `match_chunks` with an empty project filter returns EVERY row in its table
-- (see its WHERE clause: array_length(filter_project_ids,1) is null passes
-- everything). Email added to `chunks` would therefore leak into
-- search_knowledge_base on the very next query — the pollution of curated CRM
-- answers this feature exists to avoid — governed only by a WHERE clause that
-- any future caller can forget.
--
-- Two measurements settled it:
--   * email would be ~79% of a combined index (~8,500 email chunks against
--     2,313 curated), so every CRM query that works well today would begin
--     competing against a corpus 3.7x its size;
--   * a separate table means ZERO changes to the four existing match_chunks
--     call sites, and therefore no way for this to regress retrieval already in
--     daily use.
--
-- Separation becomes a property of the schema rather than a discipline.
create table if not exists thread_chunks (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references email_threads(id) on delete cascade,

  -- 'body'       — text of the messages themselves
  -- 'attachment' — extracted text of a file that came with them, which is where
  --                bonding, licensing and registration terms actually live
  source text not null default 'body' check (source in ('body', 'attachment')),
  -- Names the file in a citation, so an answer can say WHICH document said it.
  -- Null for body chunks.
  attachment_name text,

  content text not null,
  -- Same model and dimensions as `chunks` (768, truncated + renormalized from
  -- text-embedding-qwen3-embedding-0.6b). NEVER mix embedding models across a
  -- table — a model change means wipe and re-embed, and a mismatch degrades
  -- retrieval silently rather than erroring.
  embedding vector(768),
  chunk_index integer not null,
  token_count integer,
  created_at timestamptz default now()
);

-- Mirrors idx_chunks_embedding exactly: HNSW cosine, same build parameters, so
-- this index behaves like the one already proven on this stack.
create index if not exists idx_thread_chunks_embedding
  on thread_chunks using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

create index if not exists idx_thread_chunks_thread on thread_chunks(thread_id);

-- ── 2. What has been indexed, so a grown thread can be re-indexed ───────────
--
-- Invalidation is the half that makes this stay correct. The 2026-09-09 refresh
-- work established that a thread which gains a reply is no longer represented by
-- what was stored — it clears routed_at in fetch-phase and cluster-phase for
-- exactly that reason. embedded_at is cleared in the same places, so a
-- conversation that grows is re-embedded rather than answering from a stale copy
-- of itself.
alter table email_threads add column if not exists embedded_at timestamptz;

create index if not exists idx_email_threads_unembedded
  on email_threads(last_at desc)
  where embedded_at is null;

alter table thread_chunks enable row level security;
drop policy if exists "thread_chunks_select" on thread_chunks;
create policy "thread_chunks_select" on thread_chunks
  for select using (auth.role() = 'authenticated');

-- ── 3. match_thread_chunks — retrieval, shaped like match_chunks ────────────
--
-- Deliberately the same shape as match_chunks (embedding first, filters after,
-- similarity computed the same way) so the calling code reads identically and
-- nobody has to learn a second convention. The difference is what it joins:
-- email_threads, so a hit carries the subject, mailbox, date and Gmail thread id
-- a citation needs — without a second round trip per result.
create or replace function match_thread_chunks(
  query_embedding vector(768),
  match_count integer default 12,
  filter_after timestamptz default null,
  filter_mailbox text default null
)
returns table (
  id uuid,
  thread_id uuid,
  source text,
  attachment_name text,
  content text,
  chunk_index integer,
  similarity float,
  subject text,
  mailbox text,
  gmail_thread_id text,
  participants text[],
  last_at timestamptz
)
language sql stable
as $$
  select
    tc.id,
    tc.thread_id,
    tc.source,
    tc.attachment_name,
    tc.content,
    tc.chunk_index,
    (1 - (tc.embedding <=> query_embedding))::float as similarity,
    t.subject,
    t.mailbox,
    t.gmail_thread_id,
    t.participants,
    t.last_at
  from thread_chunks tc
  join email_threads t on t.id = tc.thread_id
  where
    tc.embedding is not null
    -- filter_after is on the MAIL's date, not the chunk's creation date: the
    -- reader means "what was said recently", not "what did we index recently".
    and (filter_after is null or t.last_at >= filter_after)
    and (filter_mailbox is null or t.mailbox = filter_mailbox)
  order by tc.embedding <=> query_embedding
  limit match_count;
$$;
