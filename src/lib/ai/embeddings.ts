import { createAdminClient } from '@/lib/supabase/admin'

// gemini-embedding-001 — 768 dimensions, v1beta endpoint, drop-in for text-embedding-004
const EMBEDDING_MODEL = 'gemini-embedding-001'

// ~500 tokens ≈ 2000 chars; ~50 tokens overlap ≈ 200 chars
const CHUNK_SIZE_CHARS = 2000
const CHUNK_OVERLAP_CHARS = 200

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

interface Chunk {
  content: string
  chunkIndex: number
  tokenCount: number
}

function chunkText(text: string): Chunk[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const chunks: Chunk[] = []
  let start = 0
  let index = 0

  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE_CHARS, normalized.length)
    const content = normalized.slice(start, end).trim()

    if (content.length > 0) {
      chunks.push({
        content,
        chunkIndex: index,
        tokenCount: Math.ceil(content.length / 4),
      })
      index++
    }

    if (end >= normalized.length) break
    start = end - CHUNK_OVERLAP_CHARS
  }

  return chunks
}

// ---------------------------------------------------------------------------
// Embedding generation — direct v1 REST call (SDK uses v1beta which lacks this model)
// ---------------------------------------------------------------------------

async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY!
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      outputDimensionality: 768,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Embedding API error ${res.status}: ${errText}`)
  }

  const data = await res.json() as { embedding: { values: number[] } }
  return data.embedding.values
}

// Format a float array as a pgvector literal: [0.1,0.2,...]
function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`
}

// ---------------------------------------------------------------------------
// Public: embed an approved update
// ---------------------------------------------------------------------------

export async function embedUpdate(
  updateId: string,
  projectId: string,
  rawContent: string
): Promise<void> {
  const supabase = createAdminClient()

  // Mark as processing so UI can show status if needed later
  await supabase
    .from('updates')
    .update({ embedding_status: 'processing' })
    .eq('id', updateId)

  try {
    const chunks = chunkText(rawContent)

    for (const chunk of chunks) {
      const values = await generateEmbedding(chunk.content)
      const { error: insertErr } = await supabase.from('chunks').insert({
        project_id: projectId,
        update_id: updateId,
        content: chunk.content,
        embedding: toVectorLiteral(values),
        chunk_index: chunk.chunkIndex,
        token_count: chunk.tokenCount,
      })
      if (insertErr) throw new Error(`Chunk insert failed: ${insertErr.message}`)
    }

    await supabase
      .from('updates')
      .update({ embedding_status: 'complete' })
      .eq('id', updateId)
  } catch (err) {
    console.error('[embeddings] embedUpdate failed:', err)
    await supabase
      .from('updates')
      .update({ embedding_status: 'error' })
      .eq('id', updateId)
  }
}

// ---------------------------------------------------------------------------
// Public: embed a document's text content
// ---------------------------------------------------------------------------

export async function embedDocument(
  documentId: string,
  projectId: string,
  textContent: string
): Promise<void> {
  const supabase = createAdminClient()

  await supabase
    .from('documents')
    .update({ embedding_status: 'processing' })
    .eq('id', documentId)

  try {
    const chunks = chunkText(textContent)

    for (const chunk of chunks) {
      const values = await generateEmbedding(chunk.content)
      const { error: insertErr } = await supabase.from('chunks').insert({
        project_id: projectId,
        document_id: documentId,
        content: chunk.content,
        embedding: toVectorLiteral(values),
        chunk_index: chunk.chunkIndex,
        token_count: chunk.tokenCount,
      })
      if (insertErr) throw new Error(`Chunk insert failed: ${insertErr.message}`)
    }

    await supabase
      .from('documents')
      .update({ embedding_status: 'complete' })
      .eq('id', documentId)
  } catch (err) {
    console.error('[embeddings] embedDocument failed:', err)
    await supabase
      .from('documents')
      .update({ embedding_status: 'error' })
      .eq('id', documentId)
  }
}
