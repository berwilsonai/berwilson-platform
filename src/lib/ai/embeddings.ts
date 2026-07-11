import { createAdminClient } from '@/lib/supabase/admin'
import { isLocalEmbeddings, localEmbedding } from './local'
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
  if (isLocalEmbeddings()) {
    return localEmbedding(text)
  }

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
// Tolerant chunk insert (migration-window safe)
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Insert a chunk, transparently dropping columns the live DB doesn't have yet
 * (migration window). When PostgREST reports an unknown column (PGRST204)
 * naming one of `optionalKeys`, that key is removed and the insert retried.
 * Dropped keys accumulate in `droppedKeys` so a multi-chunk loop only pays the
 * retry once. Returns ok:false when the row is fundamentally uninsertable —
 * e.g. its only scope column doesn't exist yet, or the old
 * chunks_source_check constraint (23514) rejects it.
 */
async function insertChunkTolerant(
  supabase: AdminClient,
  payload: ChunkInsert,
  optionalKeys: readonly (keyof ChunkInsert)[],
  droppedKeys: Set<string>
): Promise<{ ok: boolean; reason?: string }> {
  const attempt: ChunkInsert = { ...payload }
  for (const key of optionalKeys) {
    if (droppedKeys.has(String(key))) delete attempt[key]
  }

  for (;;) {
    const { error } = await supabase.from('chunks').insert(attempt)
    if (!error) return { ok: true }

    // Old check constraint (pre-20260703000001) rejects opportunity-only chunks
    if (error.code === '23514') {
      return { ok: false, reason: `chunks_source_check rejected insert (migration 20260703000001 not applied yet)` }
    }

    const remaining = optionalKeys.filter((k) => k in attempt)
    if (remaining.length === 0) return { ok: false, reason: error.message }

    const named = remaining.filter((k) => error.message.includes(String(k)))
    if (error.code === 'PGRST204' || named.length > 0) {
      const toDrop = named.length > 0 ? named : remaining
      for (const k of toDrop) {
        droppedKeys.add(String(k))
        delete attempt[k]
      }
      continue
    }

    return { ok: false, reason: error.message }
  }
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

    // Migration-window tolerance: is_company dropped if 20260625000002 not applied
    const droppedKeys = new Set<string>()

    for (const chunk of chunks) {
      const values = await generateEmbedding(chunk.content)
      const payload: ChunkInsert = {
        project_id: projectId,
        document_id: documentId,
        entity_id: entityId ?? null,
        is_company: isCompany,
        content: chunk.content,
        embedding: toVectorLiteral(values),
        chunk_index: chunk.chunkIndex,
        token_count: chunk.tokenCount,
      }
      const res = await insertChunkTolerant(supabase, payload, ['is_company'], droppedKeys)
      if (!res.ok) throw new Error(`Chunk insert failed: ${res.reason}`)
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
// Public: opportunity embeddings (docs, notes, snapshots, research reports)
// All degrade to a warn + skip while migration 20260703000001 is unapplied
// (chunks.opportunity_id column / relaxed source check don't exist yet).
// ---------------------------------------------------------------------------

// Max chars fed to the chunker in one call (~100 chunks) — keeps a single
// embed pass well inside a route's maxDuration.
const MAX_EMBED_CHARS = 200_000

async function insertOpportunityChunks(
  supabase: AdminClient,
  opportunityId: string,
  text: string,
  sourceType: 'opportunity' | 'opportunity_document' | 'opportunity_note' | 'email_research_report',
  opportunityDocumentId?: string | null
): Promise<boolean> {
  const chunks = chunkText(text.slice(0, MAX_EMBED_CHARS))
  const droppedKeys = new Set<string>()

  for (const chunk of chunks) {
    const values = await generateEmbedding(chunk.content)
    const payload: ChunkInsert = {
      opportunity_id: opportunityId,
      opportunity_document_id: opportunityDocumentId ?? null,
      source_type: sourceType,
      content: chunk.content,
      embedding: toVectorLiteral(values),
      chunk_index: chunk.chunkIndex,
      token_count: chunk.tokenCount,
    }
    // source_type / opportunity_document_id are droppable; opportunity_id is
    // not — without it the chunk has no scope, so a missing column means the
    // migration isn't applied and we skip embedding entirely.
    const res = await insertChunkTolerant(
      supabase,
      payload,
      ['source_type', 'opportunity_document_id'],
      droppedKeys
    )
    if (!res.ok) {
      console.warn(`[embeddings] opportunity chunk skipped (${sourceType}): ${res.reason}`)
      return false
    }
  }
  return true
}

/** Embed the full text of an opportunity document (replaces its prior chunks). */
export async function embedOpportunityDocument(
  oppDocId: string,
  opportunityId: string,
  textContent: string
): Promise<void> {
  const supabase = createAdminClient()
  try {
    const { error: delErr } = await supabase
      .from('chunks')
      .delete()
      .eq('opportunity_document_id', oppDocId)
    if (delErr) {
      console.warn(`[embeddings] embedOpportunityDocument skipped (migration pending?): ${delErr.message}`)
      return
    }
    await insertOpportunityChunks(supabase, opportunityId, textContent, 'opportunity_document', oppDocId)
  } catch (err) {
    console.error('[embeddings] embedOpportunityDocument failed:', err)
  }
}

/**
 * Embed a one-chunk snapshot of an opportunity's core fields so semantic
 * search can find the opportunity itself. Delete-and-replace.
 */
export async function embedOpportunitySnapshot(opportunityId: string): Promise<void> {
  const supabase = createAdminClient()
  try {
    const { data: opp } = await supabase
      .from('opportunities')
      .select('name, opp_type, status, priority, description, objective, thesis, target_name, counterparty, sector, location, estimated_value, deal_structure, lead, next_step')
      .eq('id', opportunityId)
      .single()
    if (!opp) return

    const parts: string[] = [`Opportunity: ${opp.name}`]
    if (opp.opp_type) parts.push(`Type: ${opp.opp_type}`)
    if (opp.status) parts.push(`Status: ${opp.status}`)
    if (opp.priority) parts.push(`Priority: ${opp.priority}`)
    if (opp.sector) parts.push(`Sector: ${opp.sector}`)
    if (opp.location) parts.push(`Location: ${opp.location}`)
    if (opp.target_name) parts.push(`Target: ${opp.target_name}`)
    if (opp.counterparty) parts.push(`Counterparty: ${opp.counterparty}`)
    if (opp.estimated_value) parts.push(`Estimated Value: $${Number(opp.estimated_value).toLocaleString()}`)
    if (opp.deal_structure) parts.push(`Deal Structure: ${opp.deal_structure}`)
    if (opp.lead) parts.push(`Internal Lead: ${opp.lead}`)
    if (opp.description) parts.push(`Description: ${opp.description}`)
    if (opp.objective) parts.push(`Objective: ${opp.objective}`)
    if (opp.thesis) parts.push(`Thesis: ${opp.thesis}`)
    if (opp.next_step) parts.push(`Next Step: ${opp.next_step}`)

    const text = parts.join('\n')
    if (text.length < 30) return

    const { error: delErr } = await supabase
      .from('chunks')
      .delete()
      .eq('opportunity_id', opportunityId)
      .eq('source_type', 'opportunity')
    if (delErr) {
      console.warn(`[embeddings] embedOpportunitySnapshot skipped (migration pending?): ${delErr.message}`)
      return
    }

    await insertOpportunityChunks(supabase, opportunityId, text, 'opportunity')
  } catch (err) {
    console.error('[embeddings] embedOpportunitySnapshot failed:', err)
  }
}

/** Embed an opportunity progress note (append-only). */
export async function embedOpportunityNote(
  opportunityId: string,
  noteBody: string,
  author?: string | null
): Promise<void> {
  const supabase = createAdminClient()
  try {
    const { data: opp } = await supabase
      .from('opportunities')
      .select('name')
      .eq('id', opportunityId)
      .single()

    const date = new Date().toISOString().slice(0, 10)
    const byline = author ? ` by ${author}` : ''
    const text = `Note on opportunity ${opp?.name ?? opportunityId}${byline} (${date}): ${noteBody}`
    if (noteBody.trim().length < 5) return

    await insertOpportunityChunks(supabase, opportunityId, text, 'opportunity_note')
  } catch (err) {
    console.error('[embeddings] embedOpportunityNote failed:', err)
  }
}

/** Embed a confirmed email-research report against its opportunity (append-only). */
export async function embedOpportunityReport(
  opportunityId: string,
  rawText: string
): Promise<void> {
  const supabase = createAdminClient()
  try {
    if (!rawText || rawText.trim().length < 20) return
    await insertOpportunityChunks(supabase, opportunityId, rawText.slice(0, 100_000), 'email_research_report')
  } catch (err) {
    console.error('[embeddings] embedOpportunityReport failed:', err)
  }
}

// ---------------------------------------------------------------------------
// Public: investor snapshot (delete-and-replace)
// Degrades to a warn + skip while migration 20260710000002 is unapplied
// (chunks.investor_id column / relaxed source check don't exist yet).
// ---------------------------------------------------------------------------

/**
 * Embed a snapshot of an investor relationship — core fields, every
 * investment (target, stage, amounts, terms), and the latest contact-log
 * notes — so /intel and the agent's search_knowledge_base find investors.
 * Called after any investor/investment/note write; delete-and-replace keeps
 * exactly one snapshot per investor.
 */
export async function embedInvestorSnapshot(investorId: string): Promise<void> {
  const supabase = createAdminClient()
  try {
    const [{ data: inv }, { data: investments }, { data: notes }] = await Promise.all([
      supabase
        .from('investors')
        .select('name, investor_type, stage, interest_level, email, phone, check_size_min, check_size_max, preferred_structures, sector_interests, source, referred_by, next_step, next_step_date, last_contact_date, notes')
        .eq('id', investorId)
        .single(),
      supabase
        .from('investments')
        .select('target_kind, stage, instrument, amount_indicated, amount_committed, amount_funded, equity_pct, profit_share_pct, preferred_return_pct, terms_notes, target_close_date, next_step, project:projects(name), spv:entities!investments_spv_entity_id_fkey(name), raise:raises(name)')
        .eq('investor_id', investorId),
      supabase
        .from('investor_notes')
        .select('body, author, created_at')
        .eq('investor_id', investorId)
        .order('created_at', { ascending: false })
        .limit(5),
    ])
    if (!inv) return

    const money = (v: number | null) => (v != null ? `$${Number(v).toLocaleString()}` : null)

    const parts: string[] = [`Investor: ${inv.name}`]
    parts.push(`Type: ${inv.investor_type}`)
    parts.push(`Relationship Stage: ${inv.stage}`)
    if (inv.interest_level) parts.push(`Interest Level: ${inv.interest_level}`)
    const contact = [inv.email, inv.phone].filter(Boolean).join(', ')
    if (contact) parts.push(`Contact: ${contact}`)
    const range = [money(inv.check_size_min), money(inv.check_size_max)].filter(Boolean).join(' to ')
    if (range) parts.push(`Typical Check Size: ${range}`)
    if (inv.preferred_structures?.length) parts.push(`Preferred Structures: ${inv.preferred_structures.join(', ')}`)
    if (inv.sector_interests?.length) parts.push(`Sector Interests: ${inv.sector_interests.join(', ')}`)
    if (inv.source) parts.push(`Source: ${inv.source}`)
    if (inv.referred_by) parts.push(`Referred By: ${inv.referred_by}`)
    if (inv.last_contact_date) parts.push(`Last Contact: ${inv.last_contact_date}`)
    if (inv.next_step) parts.push(`Next Step: ${inv.next_step}${inv.next_step_date ? ` (by ${inv.next_step_date})` : ''}`)
    if (inv.notes) parts.push(`Background: ${inv.notes}`)

    for (const i of investments ?? []) {
      const target =
        i.target_kind === 'company'
          ? 'Ber Wilson parent company'
          : `project ${(i.project as { name: string } | null)?.name ?? 'unknown'}`
      const spv = (i.spv as { name: string } | null)?.name
      const raise = (i.raise as { name: string } | null)?.name
      const line = [
        `Investment in ${target}${raise ? ` under raise "${raise}"` : ''}${spv ? ` (SPV: ${spv})` : ''}: stage ${i.stage}`,
        i.instrument ? `instrument ${i.instrument}` : null,
        i.amount_indicated != null ? `indicated ${money(i.amount_indicated)}` : null,
        i.amount_committed != null ? `committed ${money(i.amount_committed)}` : null,
        i.amount_funded != null ? `funded ${money(i.amount_funded)}` : null,
        i.equity_pct != null ? `equity ${i.equity_pct}%` : null,
        i.profit_share_pct != null ? `profit share ${i.profit_share_pct}%` : null,
        i.preferred_return_pct != null ? `preferred return ${i.preferred_return_pct}%` : null,
        i.target_close_date ? `target close ${i.target_close_date}` : null,
        i.next_step ? `next step: ${i.next_step}` : null,
      ].filter(Boolean).join(', ')
      parts.push(line)
      if (i.terms_notes) parts.push(`Terms notes: ${i.terms_notes}`)
    }

    for (const n of notes ?? []) {
      const when = n.created_at ? new Date(n.created_at).toISOString().slice(0, 10) : ''
      parts.push(`Contact log${n.author ? ` (${n.author}` : ' ('}${when ? `, ${when})` : ')'}: ${n.body}`)
    }

    const text = parts.join('\n')
    if (text.length < 30) return

    const { error: delErr } = await supabase
      .from('chunks')
      .delete()
      .eq('investor_id', investorId)
    if (delErr) {
      console.warn(`[embeddings] embedInvestorSnapshot skipped (migration pending?): ${delErr.message}`)
      return
    }

    const chunks = chunkText(text.slice(0, MAX_EMBED_CHARS))
    const droppedKeys = new Set<string>()
    for (const chunk of chunks) {
      const values = await generateEmbedding(chunk.content)
      const payload: ChunkInsert = {
        investor_id: investorId,
        source_type: 'investor',
        content: chunk.content,
        embedding: toVectorLiteral(values),
        chunk_index: chunk.chunkIndex,
        token_count: chunk.tokenCount,
      }
      // source_type is droppable; investor_id is the chunk's only scope, so a
      // missing column means the migration isn't applied — skip embedding.
      const res = await insertChunkTolerant(supabase, payload, ['source_type'], droppedKeys)
      if (!res.ok) {
        console.warn(`[embeddings] investor chunk skipped: ${res.reason}`)
        return
      }
    }
  } catch (err) {
    console.error('[embeddings] embedInvestorSnapshot failed:', err)
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
