/**
 * POST /api/ai/synthesize
 *
 * Phase 3 hybrid retrieval + synthesis pipeline.
 * Steps:
 *  1. Auth
 *  2. Parse query intent (Gemini) → project hints, date range
 *  3. Resolve project hints → project_ids
 *  4. Embed the query (Gemini embedding-001)
 *  5. Vector search via match_chunks RPC (SQL filter + vector ORDER BY)
 *  6. Re-rank: recency(0.3) + confidence(0.3) + similarity(0.4)
 *  7. Take top 8
 *  8. Generate cited answer (Claude Sonnet)
 *  9. Log to ai_queries
 * 10. Return structured response
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit } from '@/lib/rate-limit'
import { callGemini } from '@/lib/ai/gemini'
import {
  SYNTHESIS_SYSTEM_PROMPT,
  SYNTHESIS_PROMPT_VERSION,
  buildSynthesisMessage,
} from '@/lib/ai/prompts/synthesis'
import type { SynthesisResponse, ChunkWithProject, QueryIntent } from '@/types/domain'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
const EMBEDDING_MODEL = 'gemini-embedding-001'
const EMBEDDING_API = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`

// ---------------------------------------------------------------------------
// Query intent extraction prompt
// ---------------------------------------------------------------------------

const INTENT_SYSTEM_PROMPT = `You are a query parser for a construction executive intelligence platform.

Given an executive's question, extract:
- project_name_hints: fragments of project names or references mentioned (e.g. "Fort Bragg", "SLC deal", "data center"). Empty array if none mentioned.
- entity_name_hints: vendor or company names mentioned (e.g. "Turner Construction", "the HVAC vendor", "Smith & Associates"). Empty array if none mentioned.
- date_range_days: how far back to search. Use 30 for "this month", 90 for "recent/quarter", 365 for "this year", null for "all time" or unspecified.
- is_cross_project: true if asking about "all projects", "across the portfolio", or no specific project.
- is_vendor_query: true if asking about vendors, subcontractors, or searching across vendor capabilities/certifications (e.g. "which vendors have...", "who is certified for...", "find a sub that...").

Return ONLY valid JSON: {"project_name_hints": [], "entity_name_hints": [], "date_range_days": null, "is_cross_project": true, "is_vendor_query": false}`

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(`${EMBEDDING_API}?key=${process.env.GEMINI_API_KEY!}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      outputDimensionality: 768,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Embedding API error ${res.status}: ${err}`)
  }
  const data = await res.json() as { embedding: { values: number[] } }
  return data.embedding.values
}

// ---------------------------------------------------------------------------
// Re-ranking
// ---------------------------------------------------------------------------

interface RawChunk {
  id: string
  project_id: string | null
  update_id: string | null
  document_id: string | null
  entity_id: string | null
  party_id: string | null
  content: string
  chunk_index: number
  token_count: number | null
  created_at: string
  similarity: number
  source_confidence: number
}

function rerank(chunks: RawChunk[], topN = 8): (RawChunk & { final_score: number })[] {
  const now = Date.now()

  return chunks
    .map((c) => {
      const ageMs = now - new Date(c.created_at).getTime()
      const ageDays = ageMs / (1000 * 60 * 60 * 24)
      // Recency: 1.0 today, decays to ~0.5 at 7 days, ~0.2 at 30 days
      const recency = 1 / (1 + ageDays * 0.05)
      const confidence = Number(c.source_confidence) || 0.5
      const similarity = Math.max(0, Math.min(1, c.similarity))

      const final_score = 0.3 * recency + 0.3 * confidence + 0.4 * similarity

      return { ...c, final_score }
    })
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, topN)
}

/**
 * LLM-based reranker — ask Gemini to score chunk relevance to the query.
 * Falls back to heuristic reranking if this fails.
 */
async function llmRerank(
  query: string,
  chunks: (RawChunk & { final_score: number })[],
  userId: string,
  topN = 8
): Promise<(RawChunk & { final_score: number })[]> {
  if (chunks.length <= 3) return chunks // Not worth reranking few results

  try {
    const passages = chunks.map((c, i) => `[${i + 1}] ${c.content.slice(0, 300)}`).join('\n\n')

    const result = await callGemini<{ rankings: number[] }>({
      task: 'rerank',
      systemPrompt: `You are a relevance reranker for a construction executive intelligence platform.
Given a query and numbered passages, return a JSON object with a "rankings" array containing the passage numbers ordered from most to least relevant to the query.
Only include passages that are actually relevant. Omit irrelevant ones.
Return ONLY valid JSON: {"rankings": [3, 1, 5]}`,
      userMessage: `QUERY: ${query}\n\nPASSAGES:\n${passages}`,
      userId,
      maxTokens: 200,
    })

    const rankings = result.data.rankings
    if (!Array.isArray(rankings) || rankings.length === 0) return chunks

    // Reorder chunks based on LLM rankings
    const reordered: (RawChunk & { final_score: number })[] = []
    for (const rank of rankings) {
      const idx = rank - 1
      if (idx >= 0 && idx < chunks.length) {
        // Boost final_score by position in LLM ranking
        const boostFactor = 1 + (rankings.length - reordered.length) * 0.05
        reordered.push({ ...chunks[idx], final_score: chunks[idx].final_score * boostFactor })
      }
    }

    // Append any chunks the LLM didn't mention (with reduced scores)
    for (const c of chunks) {
      if (!reordered.find(r => r.id === c.id)) {
        reordered.push({ ...c, final_score: c.final_score * 0.5 })
      }
    }

    return reordered.slice(0, topN)
  } catch {
    // Non-fatal — fall back to heuristic ranking
    return chunks
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = checkRateLimit(`synthesize:${user.id}`, 15, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    )
  }

  let body: { query?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const query = body.query?.trim()
  if (!query || query.length < 3) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 2. Parse query intent
  let intent: QueryIntent = { project_name_hints: [], date_range_days: null, is_cross_project: true }
  try {
    const intentResult = await callGemini<QueryIntent>({
      task: 'classify',
      systemPrompt: INTENT_SYSTEM_PROMPT,
      userMessage: query,
      userId: user.id,
    })
    intent = intentResult.data
  } catch {
    // Non-fatal — fall back to cross-project, all-time search
  }

  // 3. Resolve project_name_hints → project_ids
  let filterProjectIds: string[] = []
  let projectMap: Record<string, string> = {} // id → name

  const { data: allProjects } = await admin
    .from('projects')
    .select('id, name')
    .eq('status', 'active')

  const projects = allProjects ?? []
  for (const p of projects) {
    projectMap[p.id] = p.name
  }

  if (!intent.is_cross_project && intent.project_name_hints.length > 0) {
    for (const hint of intent.project_name_hints) {
      const lowerHint = hint.toLowerCase()
      const match = projects.find((p) =>
        p.name.toLowerCase().includes(lowerHint) ||
        lowerHint.includes(p.name.toLowerCase().split(' ')[0])
      )
      if (match) filterProjectIds.push(match.id)
    }
  }

  // 3b. Expand filterProjectIds to include children of any matched parent projects
  if (filterProjectIds.length > 0) {
    const { data: childRows } = await admin
      .from('projects')
      .select('id, name')
      .in('parent_project_id', filterProjectIds)

    for (const child of childRows ?? []) {
      if (!filterProjectIds.includes(child.id)) {
        filterProjectIds.push(child.id)
        projectMap[child.id] = child.name
      }
    }
  }

  // 3c. Resolve entity_name_hints → entity_ids
  let filterEntityIds: string[] = []
  const entityMap: Record<string, string> = {} // id → name

  const entityHints = (intent as Record<string, unknown>).entity_name_hints as string[] | undefined
  const isVendorQuery = (intent as Record<string, unknown>).is_vendor_query as boolean | undefined

  if (entityHints && entityHints.length > 0) {
    const { data: allEntities } = await admin.from('entities').select('id, name')
    for (const hint of entityHints) {
      const lowerHint = hint.toLowerCase()
      const match = (allEntities ?? []).find((e) =>
        e.name.toLowerCase().includes(lowerHint) ||
        lowerHint.includes(e.name.toLowerCase().split(' ')[0])
      )
      if (match) {
        filterEntityIds.push(match.id)
        entityMap[match.id] = match.name
      }
    }
  }

  // For cross-vendor queries ("which vendors have X?"), load all entity names for context
  if (isVendorQuery && filterEntityIds.length === 0) {
    const { data: allEntities } = await admin.from('entities').select('id, name')
    for (const e of allEntities ?? []) {
      entityMap[e.id] = e.name
    }
  }

  // 3d. Load company profile for qualification context (non-fatal if missing)
  let companyContext = ''
  try {
    const [{ data: cp }, { data: certs }] = await Promise.all([
      admin.from('company_profile').select('legal_name, capabilities, naics_codes, dbe_certified, mbe_certified, wbe_certified, sbe_certified, bonding_capacity, aggregate_bonding').limit(1).single(),
      admin.from('certifications').select('name, issuing_body, expiration_date, is_active').eq('is_active', true).order('name'),
    ])
    if (cp) {
      const today = new Date().toISOString().split('T')[0]
      const certLines = (certs ?? []).map(c => {
        const expired = c.expiration_date && c.expiration_date < today ? ' [EXPIRED]' : ''
        return `- ${c.name}${c.issuing_body ? ` (${c.issuing_body})` : ''}${expired}`
      }).join('\n')
      const diversity = [cp.dbe_certified && 'DBE', cp.mbe_certified && 'MBE', cp.wbe_certified && 'WBE', cp.sbe_certified && 'SBE'].filter(Boolean).join(', ')
      companyContext = `BER WILSON PROFILE (use when answering questions about qualifications, RFP eligibility, or due diligence):
Legal Name: ${cp.legal_name}
NAICS: ${(cp.naics_codes ?? []).join(', ') || 'not set'}
Diversity: ${diversity || 'none certified'}
Bonding: Single $${cp.bonding_capacity ? (cp.bonding_capacity / 1_000_000).toFixed(1) + 'M' : 'TBD'} | Aggregate $${cp.aggregate_bonding ? (cp.aggregate_bonding / 1_000_000).toFixed(1) + 'M' : 'TBD'}
Capabilities: ${cp.capabilities?.slice(0, 400) ?? 'not set'}
Active Certifications:\n${certLines || '(none on file)'}

---

`
    }
  } catch {
    // Non-fatal — synthesis continues without company context
  }

  // 4. Embed the query
  let queryEmbedding: number[]
  try {
    queryEmbedding = await embedQuery(query)
  } catch (err) {
    console.error('[synthesize] Embedding failed:', err)
    return NextResponse.json({ error: 'Failed to embed query' }, { status: 500 })
  }

  // 5. Vector search via RPC
  const filterAfter = intent.date_range_days
    ? new Date(Date.now() - intent.date_range_days * 24 * 60 * 60 * 1000).toISOString()
    : null

  const { data: rawChunks, error: rpcError } = await admin.rpc('match_chunks', {
    query_embedding: `[${queryEmbedding.join(',')}]`,
    filter_project_ids: filterProjectIds.length > 0 ? filterProjectIds : [],
    filter_after: filterAfter ?? '2000-01-01T00:00:00.000Z',
    match_count: 20,
    filter_entity_ids: filterEntityIds.length > 0 ? filterEntityIds : [],
    // When narrowed to specific projects, still union the company knowledge base.
    filter_include_company: filterProjectIds.length > 0,
  })

  if (rpcError) {
    console.error('[synthesize] match_chunks RPC failed:', rpcError.message)
    return NextResponse.json({ error: 'Vector search failed' }, { status: 500 })
  }

  const chunks = (rawChunks ?? []) as RawChunk[]

  // 6 & 7. Re-rank: heuristic first, then LLM reranker for precision
  const heuristicRanked = rerank(chunks, 12)
  const topChunks = await llmRerank(query, heuristicRanked, user.id, 8)

  // 8. Handle no-data case
  if (topChunks.length === 0) {
    const suggestions = buildNoDataSuggestions(query, intent)
    return NextResponse.json({
      answer: suggestions,
      citations: [],
      query_intent: intent,
      ai_query_id: null,
      no_data: true,
      low_confidence: false,
      model_used: 'n/a',
      latency_ms: 0,
    } satisfies SynthesisResponse)
  }

  // Flag if all chunks are low confidence
  const allLowConfidence = topChunks.every((c) => Number(c.source_confidence) < 0.5)

  // 9. Build context for Sonnet
  const contextChunks = topChunks.map((c, i) => {
    let sourceName = c.project_id ? (projectMap[c.project_id] ?? 'Unknown Project') : ''
    if (c.entity_id && entityMap[c.entity_id]) {
      sourceName = `Vendor: ${entityMap[c.entity_id]}`
    }
    if (!sourceName) sourceName = 'Enrichment Data'

    return {
      index: i + 1,
      projectName: sourceName,
      content: c.content,
      createdAt: new Date(c.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      }),
      daysOld: Math.floor((Date.now() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    }
  })

  const userMessage = companyContext + buildSynthesisMessage(query, contextChunks)

  // 10. Generate answer (Gemini 2.5 Flash — prose mode, no JSON)
  const startSynthesis = Date.now()
  const synthesisResult = await callGemini<string>({
    task: 'synthesize',
    systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
    userMessage,
    userId: user.id,
    promptVersion: SYNTHESIS_PROMPT_VERSION,
    maxTokens: 2048,
    jsonMode: false,
  })
  const totalLatencyMs = Date.now() - startSynthesis

  const answer = synthesisResult.data as string

  // 11. Build citation objects for the UI
  const citations: ChunkWithProject[] = topChunks.map((c, i) => {
    let sourceName = c.project_id ? (projectMap[c.project_id] ?? 'Unknown Project') : ''
    if (c.entity_id && entityMap[c.entity_id]) {
      sourceName = `Vendor: ${entityMap[c.entity_id]}`
    }
    if (!sourceName) sourceName = 'Enrichment Data'

    return {
      citation_index: i + 1,
      id: c.id,
      project_id: c.project_id ?? '',
      project_name: sourceName,
      update_id: c.update_id,
      document_id: c.document_id,
      entity_id: c.entity_id,
      party_id: c.party_id,
      content: c.content,
      created_at: c.created_at,
      similarity: c.similarity,
      source_confidence: Number(c.source_confidence),
      final_score: c.final_score,
    }
  })

  // Log to ai_queries and return the real ID for rating
  let aiQueryId: string | null = null
  try {
    const { data: logged } = await admin
      .from('ai_queries')
      .insert({
        user_id: user.id,
        query_text: query,
        response_text: answer,
        cited_records: topChunks.map((c) => c.id),
        model_used: synthesisResult.model,
        prompt_version: SYNTHESIS_PROMPT_VERSION,
        latency_ms: totalLatencyMs,
      })
      .select('id')
      .single()
    aiQueryId = logged?.id ?? null
  } catch {
    // Non-fatal — don't fail the response if logging fails
  }

  return NextResponse.json({
    answer,
    citations,
    query_intent: intent,
    ai_query_id: aiQueryId,
    no_data: false,
    low_confidence: allLowConfidence,
    model_used: synthesisResult.model,
    latency_ms: totalLatencyMs,
  } satisfies SynthesisResponse)
}

// ---------------------------------------------------------------------------
// No-data fallback message
// ---------------------------------------------------------------------------

function buildNoDataSuggestions(query: string, intent: QueryIntent): string {
  const projectHint = intent.project_name_hints.length > 0
    ? `on "${intent.project_name_hints.join(', ')}"`
    : 'in the system'

  return `I don't have any data ${projectHint} that matches this query.

This could mean:
- No updates, emails, or documents have been processed for the relevant project(s) yet
- The information exists but hasn't been uploaded or pasted into the system
- The date range filter excluded relevant content (try asking without a time reference)

**To get answers like this in the future:**
- Paste meeting notes, email threads, or status updates into the project's Updates tab
- Once emails are live, they'll auto-populate here
- For external research (company backgrounds, market data), use the Research tab on the project`
}
