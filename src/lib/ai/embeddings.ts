import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

type ChunkInsert = Database['public']['Tables']['chunks']['Insert']

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

/**
 * Embed a query string for vector search (768-dim, gemini-embedding-001).
 * Shared by the agent, the /intel synthesize route, and company-knowledge retrieval.
 */
export async function embedQuery(text: string): Promise<number[]> {
  return generateEmbedding(text)
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
  projectId: string | null,
  textContent: string,
  entityId?: string | null,
  isCompany = false
): Promise<void> {
  const supabase = createAdminClient()

  await supabase
    .from('documents')
    .update({ embedding_status: 'processing' })
    .eq('id', documentId)

  try {
    const chunks = chunkText(textContent)

    // Migration-window fallback: drop is_company if the column doesn't exist yet
    // (migration 20260625000002 not applied). Set false after the first miss so
    // the rest of the loop skips it too.
    let includeCompany = true

    for (const chunk of chunks) {
      const values = await generateEmbedding(chunk.content)
      const payload: ChunkInsert = {
        project_id: projectId,
        document_id: documentId,
        entity_id: entityId ?? null,
        content: chunk.content,
        embedding: toVectorLiteral(values),
        chunk_index: chunk.chunkIndex,
        token_count: chunk.tokenCount,
      }
      if (includeCompany) payload.is_company = isCompany
      let { error: insertErr } = await supabase.from('chunks').insert(payload)
      if (insertErr && includeCompany && (insertErr.code === 'PGRST204' || /is_company/i.test(insertErr.message))) {
        includeCompany = false
        delete payload.is_company
        ;({ error: insertErr } = await supabase.from('chunks').insert(payload))
      }
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

// ---------------------------------------------------------------------------
// Public: embed enrichment data for an entity (vendor)
// ---------------------------------------------------------------------------

export async function embedEntityEnrichment(
  entityId: string
): Promise<void> {
  const supabase = createAdminClient()

  // Delete any existing enrichment chunks for this entity
  await supabase
    .from('chunks')
    .delete()
    .eq('entity_id', entityId)
    .is('document_id', null)
    .is('update_id', null)

  // Load enrichment data
  const { data: entity } = await supabase
    .from('entities')
    .select('name, description, specialties, enrichment_data')
    .eq('id', entityId)
    .single()

  if (!entity) return

  // Serialize to readable text
  const parts: string[] = [`Company: ${entity.name}`]
  if (entity.description) parts.push(`Description: ${entity.description}`)
  if (entity.specialties?.length) parts.push(`Specialties: ${entity.specialties.join(', ')}`)

  const ed = entity.enrichment_data as Record<string, unknown> | null
  if (ed) {
    if (ed.services && Array.isArray(ed.services)) parts.push(`Services: ${ed.services.join(', ')}`)
    if (ed.certifications && Array.isArray(ed.certifications)) parts.push(`Certifications: ${ed.certifications.join(', ')}`)
    if (ed.key_clients && Array.isArray(ed.key_clients)) parts.push(`Key Clients: ${ed.key_clients.join(', ')}`)
    if (ed.notable_projects && Array.isArray(ed.notable_projects)) parts.push(`Notable Projects: ${ed.notable_projects.join(', ')}`)
    if (ed.government_contract_history) parts.push(`Government Contract History: ${ed.government_contract_history}`)
    if (ed.founded_year) parts.push(`Founded: ${ed.founded_year}`)
    if (ed.employee_count) parts.push(`Employee Count: ${ed.employee_count}`)
  }

  const text = parts.join('\n')
  if (text.length < 20) return

  try {
    const chunks = chunkText(text)
    for (const chunk of chunks) {
      const values = await generateEmbedding(chunk.content)
      await supabase.from('chunks').insert({
        entity_id: entityId,
        content: chunk.content,
        embedding: toVectorLiteral(values),
        chunk_index: chunk.chunkIndex,
        token_count: chunk.tokenCount,
      })
    }
  } catch (err) {
    console.error('[embeddings] embedEntityEnrichment failed:', err)
  }
}

// ---------------------------------------------------------------------------
// Public: embed enrichment data for a party (contact)
// ---------------------------------------------------------------------------

export async function embedPartyEnrichment(
  partyId: string
): Promise<void> {
  const supabase = createAdminClient()

  // Delete any existing enrichment chunks for this party
  await supabase
    .from('chunks')
    .delete()
    .eq('party_id', partyId)
    .is('document_id', null)
    .is('update_id', null)

  // Load enrichment data
  const { data: party } = await supabase
    .from('parties')
    .select('full_name, title, company, enrichment_notes, government_contract_history')
    .eq('id', partyId)
    .single()

  if (!party) return

  // Serialize to readable text
  const parts: string[] = [`Person: ${party.full_name}`]
  if (party.title) parts.push(`Title: ${party.title}`)
  if (party.company) parts.push(`Company: ${party.company}`)
  if (party.government_contract_history) parts.push(`Government Contract History: ${party.government_contract_history}`)

  const en = party.enrichment_notes as Record<string, unknown> | null
  if (en) {
    if (en.years_of_experience) parts.push(`Experience: ${en.years_of_experience}`)
    if (en.certifications && Array.isArray(en.certifications)) parts.push(`Certifications: ${en.certifications.join(', ')}`)
    if (en.personal_credentials && Array.isArray(en.personal_credentials)) parts.push(`Credentials: ${en.personal_credentials.join(', ')}`)
    if (en.past_projects && Array.isArray(en.past_projects)) parts.push(`Past Projects: ${en.past_projects.join(', ')}`)
    if (en.litigation_history && Array.isArray(en.litigation_history)) parts.push(`Litigation: ${en.litigation_history.join(', ')}`)
    if (en.notable_affiliations && Array.isArray(en.notable_affiliations)) parts.push(`Affiliations: ${en.notable_affiliations.join(', ')}`)
  }

  const text = parts.join('\n')
  if (text.length < 20) return

  try {
    const chunks = chunkText(text)
    for (const chunk of chunks) {
      const values = await generateEmbedding(chunk.content)
      await supabase.from('chunks').insert({
        party_id: partyId,
        content: chunk.content,
        embedding: toVectorLiteral(values),
        chunk_index: chunk.chunkIndex,
        token_count: chunk.tokenCount,
      })
    }
  } catch (err) {
    console.error('[embeddings] embedPartyEnrichment failed:', err)
  }
}
