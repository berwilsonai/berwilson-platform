/**
 * POST /api/parties/[id]/enrich
 *
 * Two-step enrichment pipeline:
 *   1. Microsoft Graph — query Outlook contacts by email (requires OAuth setup)
 *   2. Gemini grounded search — person + company queries → structured extraction
 *
 * Body: {} → returns preview (does NOT save)
 * Body: { confirm: true, enriched: {...} } → saves to DB
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { researchQuery } from '@/lib/ai/perplexity'
import { callGemini } from '@/lib/ai/gemini'
import type { TablesUpdate } from '@/lib/supabase/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnrichmentPreview {
  linkedin_url: string | null
  title: string | null
  company: string | null
  full_name: string | null
  government_contract_history: string | null
  enrichment_notes: {
    years_of_experience?: string | null
    past_projects?: string[] | null
    certifications?: string[] | null
    news_mentions?: string[] | null
    notable_affiliations?: string[] | null
    raw_text?: string
  }
  sources: Array<{ url: string; title?: string }>
  graph_done: boolean
}

export interface EnrichmentConflict {
  field: string
  current: string
  enriched: string
}

export interface EnrichPreviewResponse {
  preview: EnrichmentPreview
  conflicts: EnrichmentConflict[]
  current: {
    full_name: string
    title: string | null
    company: string | null
    linkedin_url: string | null
    government_contract_history: string | null
  }
}

// ── Graph contact lookup ───────────────────────────────────────────────────────

interface GraphContactResult {
  displayName?: string
  jobTitle?: string
  companyName?: string
  department?: string
  businessPhones?: string[]
  mobilePhone?: string
}

async function queryGraphForContact(email: string): Promise<GraphContactResult | null> {
  try {
    // Dynamic import to avoid build errors if integration is not set up
    const { getValidAccessToken } = await import('@/lib/integrations/microsoft-graph')
    const token = await getValidAccessToken()

    // Search Outlook contacts by email address
    const url = `https://graph.microsoft.com/v1.0/me/contacts?$filter=emailAddresses/any(a:a/address eq '${encodeURIComponent(email)}')&$select=displayName,jobTitle,companyName,department,mobilePhone,businessPhones&$top=1`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) return null
    const data = await res.json()
    const contact = data.value?.[0]
    if (!contact) return null
    return contact as GraphContactResult
  } catch {
    // Graph not yet configured or token missing — skip silently
    return null
  }
}

// ── Gemini structuring ────────────────────────────────────────────────────────

interface StructuredEnrichment {
  linkedin_url?: string | null
  years_of_experience?: string | null
  past_projects?: string[] | null
  government_contract_history?: string | null
  certifications?: string[] | null
  news_mentions?: string[] | null
  notable_affiliations?: string[] | null
}

async function structureWithGemini(
  rawTexts: string[],
  userId: string
): Promise<StructuredEnrichment> {
  const combined = rawTexts.join('\n\n---\n\n')
  const result = await callGemini<StructuredEnrichment>({
    task: 'extract',
    systemPrompt:
      'You are a data extraction engine. Given raw web search results about a person or company, extract structured fields as JSON. Return ONLY valid JSON. No explanation. No markdown fences.',
    userMessage: `Extract and structure the following fields if present from the text below. Return as JSON with these keys: linkedin_url, years_of_experience, past_projects (array), government_contract_history, certifications (array), news_mentions (array), notable_affiliations (array). If a field is not found, set it to null.\n\nText:\n${combined.slice(0, 8000)}`,
    userId,
    promptVersion: 'enrich-v1',
  })
  return (result.data ?? {}) as StructuredEnrichment
}

// ── Conflict detection ────────────────────────────────────────────────────────

function detectConflicts(
  current: Record<string, string | null>,
  enriched: Record<string, string | null>
): EnrichmentConflict[] {
  const conflicts: EnrichmentConflict[] = []
  for (const [field, enrichedVal] of Object.entries(enriched)) {
    const currentVal = current[field]
    if (currentVal && enrichedVal && currentVal !== enrichedVal) {
      conflicts.push({ field, current: currentVal, enriched: enrichedVal })
    }
  }
  return conflicts
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const admin = createAdminClient()

  // Load current party record
  const { data: party } = await admin
    .from('parties')
    .select('id, full_name, title, company, email, linkedin_url, government_contract_history, enrichment_notes, enrichment_conflicts')
    .eq('id', id)
    .single()

  if (!party) {
    return Response.json({ error: 'Contact not found' }, { status: 404 })
  }

  let body: { confirm?: boolean; enriched?: Partial<EnrichmentPreview> } = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text)
  } catch {
    // empty body is fine for preview
  }

  // ── CONFIRM: save enriched data ──────────────────────────────────────────
  if (body.confirm && body.enriched) {
    const { enriched } = body

    const update: TablesUpdate<'parties'> = {}
    const conflicts: EnrichmentConflict[] = []

    // Simple scalar fields — only set if party field is currently empty
    const scalarFields = ['linkedin_url', 'title', 'company', 'full_name', 'government_contract_history'] as const
    for (const field of scalarFields) {
      const newVal = enriched[field as keyof typeof enriched] as string | null
      const currentVal = party[field] as string | null

      if (!newVal) continue

      if (currentVal && currentVal !== newVal) {
        // Conflict — log but don't overwrite
        conflicts.push({ field, current: currentVal, enriched: newVal })
      } else if (!currentVal) {
        (update as Record<string, unknown>)[field] = newVal
      }
      // If currentVal === newVal: already set correctly, skip
    }

    if (enriched.enrichment_notes) {
      update.enrichment_notes = enriched.enrichment_notes as import('@/lib/supabase/types').Json
    }

    update.perplexity_enriched_at = new Date().toISOString()

    if (conflicts.length > 0) {
      update.enrichment_conflicts = conflicts as unknown as import('@/lib/supabase/types').Json
    }

    if (Object.keys(update).length > 0) {
      const { error } = await admin
        .from('parties')
        .update(update)
        .eq('id', id)

      if (error) {
        return Response.json({ error: error.message }, { status: 500 })
      }
    }

    return Response.json({ saved: true, conflicts })
  }

  // ── PREVIEW: run enrichment pipeline ────────────────────────────────────
  let graphResult: GraphContactResult | null = null
  let graphDone = false

  if (party.email) {
    graphResult = await queryGraphForContact(party.email)
    graphDone = graphResult !== null
  }

  // Build research queries from available data
  const namePart = party.full_name
  const companyPart = graphResult?.companyName ?? party.company ?? ''
  const titlePart = graphResult?.jobTitle ?? party.title ?? ''

  const personQuery = `${namePart}${companyPart ? ' ' + companyPart : ''}${titlePart ? ' ' + titlePart : ''} site:linkedin.com OR site:usaspending.gov OR site:sam.gov`
  const companyQuery = companyPart
    ? `${companyPart} government contracts construction history`
    : null

  const allSources: Array<{ url: string; title?: string }> = []
  const rawTexts: string[] = []

  try {
    const personRes = await researchQuery(personQuery)
    rawTexts.push(personRes.text)
    allSources.push(...personRes.sources)
  } catch (err) {
    console.error('[enrich] person query failed', err)
  }

  if (companyQuery) {
    try {
      const companyRes = await researchQuery(companyQuery)
      rawTexts.push(companyRes.text)
      allSources.push(...companyRes.sources)
    } catch (err) {
      console.error('[enrich] company query failed', err)
    }
  }

  // Structure the results
  let structured: StructuredEnrichment = {}
  if (rawTexts.length > 0) {
    try {
      structured = await structureWithGemini(rawTexts, user.id)
    } catch (err) {
      console.error('[enrich] structuring failed', err)
    }
  }

  // Build preview
  const preview: EnrichmentPreview = {
    linkedin_url: structured.linkedin_url ?? null,
    title: graphResult?.jobTitle ?? null,
    company: graphResult?.companyName ?? null,
    full_name: graphResult?.displayName ?? null,
    government_contract_history: structured.government_contract_history ?? null,
    enrichment_notes: {
      years_of_experience: structured.years_of_experience ?? null,
      past_projects: structured.past_projects ?? null,
      certifications: structured.certifications ?? null,
      news_mentions: structured.news_mentions ?? null,
      notable_affiliations: structured.notable_affiliations ?? null,
    },
    sources: allSources.filter((s, i, arr) => arr.findIndex((x) => x.url === s.url) === i).slice(0, 20),
    graph_done: graphDone,
  }

  // Detect conflicts
  const currentScalars: Record<string, string | null> = {
    linkedin_url: party.linkedin_url ?? null,
    title: party.title ?? null,
    company: party.company ?? null,
    full_name: party.full_name ?? null,
    government_contract_history: party.government_contract_history ?? null,
  }
  const previewScalars: Record<string, string | null> = {
    linkedin_url: preview.linkedin_url,
    title: preview.title,
    company: preview.company,
    full_name: preview.full_name,
    government_contract_history: preview.government_contract_history,
  }
  const conflicts = detectConflicts(currentScalars, previewScalars)

  const response: EnrichPreviewResponse = {
    preview,
    conflicts,
    current: {
      full_name: party.full_name,
      title: party.title ?? null,
      company: party.company ?? null,
      linkedin_url: party.linkedin_url ?? null,
      government_contract_history: party.government_contract_history ?? null,
    },
  }

  return Response.json(response)
}
