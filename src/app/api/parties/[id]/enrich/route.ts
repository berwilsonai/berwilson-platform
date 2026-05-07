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
import { researchQuery } from '@/lib/ai/research'
import { callGemini } from '@/lib/ai/gemini'
import { embedPartyEnrichment } from '@/lib/ai/embeddings'
import type { TablesUpdate } from '@/lib/supabase/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnrichmentPreview {
  linkedin_url: string | null
  title: string | null
  company: string | null
  full_name: string | null
  phone: string | null
  government_contract_history: string | null
  enrichment_notes: {
    years_of_experience?: string | null
    past_projects?: string[] | null
    certifications?: string[] | null
    personal_credentials?: string[] | null
    litigation_history?: string[] | null
    news_mentions?: string[] | null
    notable_affiliations?: string[] | null
    address?: string | null
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
    phone: string | null
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
  phone?: string | null
  address?: string | null
  litigation_history?: string[] | null
  personal_credentials?: string[] | null
}

async function structureWithGemini(
  personTexts: string[],
  companyTexts: string[],
  userId: string
): Promise<StructuredEnrichment> {
  const personSection = personTexts.length > 0
    ? `=== PERSON SEARCH RESULTS (PRIMARY) ===\n${personTexts.join('\n\n---\n\n').slice(0, 6000)}`
    : ''
  const companySection = companyTexts.length > 0
    ? `\n\n=== COMPANY CONTEXT (SECONDARY — use only to fill gaps about the person's role) ===\n${companyTexts.join('\n\n---\n\n').slice(0, 2000)}`
    : ''
  const combined = personSection + companySection

  const result = await callGemini<StructuredEnrichment>({
    task: 'extract',
    systemPrompt:
      'You are a data extraction engine focused on extracting information about a SPECIFIC PERSON — not their company. ' +
      'Prioritize personal details: their individual phone number, address, professional licenses, certifications they personally hold, litigation they are personally named in, and their career history. ' +
      'Company information should only be included to contextualize the person\'s role or tenure. ' +
      'Return ONLY valid JSON. No explanation. No markdown fences.',
    userMessage: `Extract information about this specific person from the text below. Prioritize the PERSON SEARCH RESULTS section. Use COMPANY CONTEXT only to fill gaps about the person's role.\n\nReturn as JSON with these keys:\n- linkedin_url (string)\n- years_of_experience (string)\n- past_projects (array of project names they personally worked on)\n- government_contract_history (string — their personal involvement)\n- certifications (array — professional certs like PE, PMP, LEED AP, etc.)\n- personal_credentials (array — licenses, security clearances, degrees)\n- litigation_history (array — lawsuits, liens, court cases they are named in)\n- phone (string — personal or direct phone number)\n- address (string — personal or business address)\n- news_mentions (array)\n- notable_affiliations (array — boards, associations, memberships)\n\nIf a field is not found, set it to null.\n\nText:\n${combined}`,
    userId,
    promptVersion: 'enrich-v2',
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
    .select('id, full_name, title, company, email, phone, linkedin_url, government_contract_history, enrichment_notes, enrichment_conflicts')
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
    const scalarFields = ['linkedin_url', 'title', 'company', 'full_name', 'phone', 'government_contract_history'] as const
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

    // Embed enrichment data into vector store for intelligence queries
    embedPartyEnrichment(id).catch(console.error)

    return Response.json({ saved: true, conflicts })
  }

  // ── PREVIEW: run enrichment pipeline ────────────────────────────────────
  let graphResult: GraphContactResult | null = null
  let graphDone = false

  if (party.email) {
    graphResult = await queryGraphForContact(party.email)
    graphDone = graphResult !== null
  }

  // Build person-focused research queries
  const namePart = party.full_name
  const companyPart = graphResult?.companyName ?? party.company ?? ''
  const titlePart = graphResult?.jobTitle ?? party.title ?? ''

  // Person queries (primary — these results get priority in extraction)
  const personQueries = [
    // LinkedIn + professional profile
    `"${namePart}"${companyPart ? ` "${companyPart}"` : ''} site:linkedin.com OR site:usaspending.gov OR site:sam.gov`,
    // Contact info + credentials
    `"${namePart}"${companyPart ? ` "${companyPart}"` : ''} phone address license credentials certification`,
    // Litigation + court records
    `"${namePart}"${companyPart ? ` ${companyPart}` : ''} litigation lawsuit lien court records`,
  ]
  // Company query (secondary context only)
  const companyQuery = companyPart
    ? `${companyPart} government contracts construction history`
    : null

  const allSources: Array<{ url: string; title?: string }> = []
  const personTexts: string[] = []
  const companyTexts: string[] = []

  // Run person queries in parallel
  const personResults = await Promise.allSettled(
    personQueries.map((q) => researchQuery(q))
  )
  for (const result of personResults) {
    if (result.status === 'fulfilled') {
      personTexts.push(result.value.text)
      allSources.push(...result.value.sources)
    } else {
      console.error('[enrich] person query failed', result.reason)
    }
  }

  if (companyQuery) {
    try {
      const companyRes = await researchQuery(companyQuery)
      companyTexts.push(companyRes.text)
      allSources.push(...companyRes.sources)
    } catch (err) {
      console.error('[enrich] company query failed', err)
    }
  }

  // Structure the results — person texts get priority
  let structured: StructuredEnrichment = {}
  if (personTexts.length > 0 || companyTexts.length > 0) {
    try {
      structured = await structureWithGemini(personTexts, companyTexts, user.id)
    } catch (err) {
      console.error('[enrich] structuring failed', err)
    }
  }

  // Build preview
  const graphPhone = graphResult?.mobilePhone ?? graphResult?.businessPhones?.[0] ?? null
  const preview: EnrichmentPreview = {
    linkedin_url: structured.linkedin_url ?? null,
    title: graphResult?.jobTitle ?? null,
    company: graphResult?.companyName ?? null,
    full_name: graphResult?.displayName ?? null,
    phone: graphPhone ?? structured.phone ?? null,
    government_contract_history: structured.government_contract_history ?? null,
    enrichment_notes: {
      years_of_experience: structured.years_of_experience ?? null,
      past_projects: structured.past_projects ?? null,
      certifications: structured.certifications ?? null,
      personal_credentials: structured.personal_credentials ?? null,
      litigation_history: structured.litigation_history ?? null,
      news_mentions: structured.news_mentions ?? null,
      notable_affiliations: structured.notable_affiliations ?? null,
      address: structured.address ?? null,
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
    phone: party.phone ?? null,
    government_contract_history: party.government_contract_history ?? null,
  }
  const previewScalars: Record<string, string | null> = {
    linkedin_url: preview.linkedin_url,
    title: preview.title,
    company: preview.company,
    full_name: preview.full_name,
    phone: preview.phone,
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
      phone: party.phone ?? null,
      linkedin_url: party.linkedin_url ?? null,
      government_contract_history: party.government_contract_history ?? null,
    },
  }

  return Response.json(response)
}
