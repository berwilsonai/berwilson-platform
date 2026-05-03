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
- date_range_days: how far back to search. Use 30 for "this month", 90 for "recent/quarter", 365 for "this year", null for "all time" or unspecified.
- is_cross_project: true if asking about "all projects", "across the portfolio", or no specific project.

Return ONLY valid JSON: {"project_name_hints": [], "date_range_days": null, "is_cross_project": true}`

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
  project_id: string
  update_id: string | null
  document_id: string | null
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

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  })

  if (rpcError) {
    console.error('[synthesize] match_chunks RPC failed:', rpcError.message)
    return NextResponse.json({ error: 'Vector search failed' }, { status: 500 })
  }

  const chunks = (rawChunks ?? []) as RawChunk[]

  // 6 & 7. Re-rank and take top 8
  const topChunks = rerank(chunks, 8)

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
  const contextChunks = topChunks.map((c, i) => ({
    index: i + 1,
    projectName: projectMap[c.project_id] ?? 'Unknown Project',
    content: c.content,
    createdAt: new Date(c.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }),
    daysOld: Math.floor((Date.now() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24)),
  }))

  const userMessage = buildSynthesisMessage(query, contextChunks)

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
  const citations: ChunkWithProject[] = topChunks.map((c, i) => ({
    citation_index: i + 1,
    id: c.id,
    project_id: c.project_id,
    project_name: projectMap[c.project_id] ?? 'Unknown Project',
    update_id: c.update_id,
    document_id: c.document_id,
    content: c.content,
    created_at: c.created_at,
    similarity: c.similarity,
    source_confidence: Number(c.source_confidence),
    final_score: c.final_score,
  }))

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
