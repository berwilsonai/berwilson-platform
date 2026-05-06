/**
 * POST /api/entities/[id]/enrich
 *
 * AI-powered vendor enrichment pipeline:
 *   1. Gemini grounded search — company name + website queries
 *   2. Gemini structuring — extract description, specialties, headquarters
 *
 * Body: {} → returns preview (does NOT save)
 * Body: { confirm: true, enriched: {...} } → saves to DB
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { researchQuery } from '@/lib/ai/perplexity'
import { callGemini } from '@/lib/ai/gemini'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EntityEnrichmentPreview {
  description: string | null
  specialties: string[] | null
  headquarters: string | null
  website_url: string | null
  enrichment_notes: {
    services?: string[] | null
    key_clients?: string[] | null
    founded_year?: string | null
    employee_count?: string | null
    certifications?: string[] | null
    notable_projects?: string[] | null
    government_contract_history?: string | null
  }
  sources: Array<{ url: string; title?: string }>
}

export interface EntityEnrichmentConflict {
  field: string
  current: string
  enriched: string
}

// ── Gemini structuring ────────────────────────────────────────────────────────

interface StructuredEntityEnrichment {
  description?: string | null
  specialties?: string[] | null
  headquarters?: string | null
  services?: string[] | null
  key_clients?: string[] | null
  founded_year?: string | null
  employee_count?: string | null
  certifications?: string[] | null
  notable_projects?: string[] | null
  government_contract_history?: string | null
}

async function structureWithGemini(
  rawTexts: string[],
  userId: string
): Promise<StructuredEntityEnrichment> {
  const combined = rawTexts.join('\n\n---\n\n')
  const result = await callGemini<StructuredEntityEnrichment>({
    task: 'extract',
    systemPrompt:
      'You are a data extraction engine for a real estate development firm researching vendors and partners. Given raw web search results about a company, extract structured fields as JSON. Return ONLY valid JSON. No explanation. No markdown fences.',
    userMessage: `Extract the following fields about this company from the text below. Return as JSON with these keys: description (1-2 sentence summary of what they do), specialties (array of service/expertise tags), headquarters (city, state), services (array of specific services offered), key_clients (array), founded_year, employee_count, certifications (array), notable_projects (array of project names), government_contract_history. If a field is not found, set it to null.\n\nText:\n${combined.slice(0, 8000)}`,
    userId,
    promptVersion: 'entity-enrich-v1',
  })
  return (result.data ?? {}) as StructuredEntityEnrichment
}

// ── Conflict detection ────────────────────────────────────────────────────────

function detectConflicts(
  current: Record<string, string | null>,
  enriched: Record<string, string | null>
): EntityEnrichmentConflict[] {
  const conflicts: EntityEnrichmentConflict[] = []
  for (const [field, enrichedVal] of Object.entries(enriched)) {
    const currentVal = current[field]
    if (currentVal && enrichedVal && currentVal !== enrichedVal) {
      conflicts.push({ field, current: currentVal, enriched: enrichedVal })
    }
  }
  return conflicts
}

// ── Route handler ─────────────────────────────────────────────────────────────

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
  // Cast to bypass generated types — new columns added via migration
  const db = admin as unknown as import('@supabase/supabase-js').SupabaseClient

  // Load current entity record
  const { data: entity } = await db
    .from('entities')
    .select('id, name, website_url, description, specialties, headquarters, enrichment_data, enriched_at')
    .eq('id', id)
    .single()

  if (!entity) {
    return Response.json({ error: 'Entity not found' }, { status: 404 })
  }

  let body: { confirm?: boolean; enriched?: Partial<EntityEnrichmentPreview> } = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text)
  } catch {
    // empty body is fine for preview
  }

  // ── CONFIRM: save enriched data ──────────────────────────────────────────
  if (body.confirm && body.enriched) {
    const { enriched } = body
    const updates: Record<string, unknown> = {}
    const conflicts: EntityEnrichmentConflict[] = []

    // Scalar fields — only set if entity field is currently empty
    if (enriched.description && !entity.description) {
      updates.description = enriched.description
    } else if (enriched.description && entity.description && entity.description !== enriched.description) {
      conflicts.push({ field: 'description', current: entity.description, enriched: enriched.description })
    }

    if (enriched.headquarters && !entity.headquarters) {
      updates.headquarters = enriched.headquarters
    } else if (enriched.headquarters && entity.headquarters && entity.headquarters !== enriched.headquarters) {
      conflicts.push({ field: 'headquarters', current: entity.headquarters, enriched: enriched.headquarters })
    }

    if (enriched.website_url && !entity.website_url) {
      updates.website_url = enriched.website_url
    }

    // Array fields — merge with existing
    if (enriched.specialties && enriched.specialties.length > 0) {
      const existing = (entity.specialties as string[]) || []
      const merged = [...new Set([...existing, ...enriched.specialties])]
      updates.specialties = merged
    }

    if (enriched.enrichment_notes) {
      updates.enrichment_data = enriched.enrichment_notes
    }

    updates.enriched_at = new Date().toISOString()

    const { error } = await db
      .from('entities')
      .update(updates)
      .eq('id', id)

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ saved: true, conflicts })
  }

  // ── PREVIEW: run enrichment pipeline ────────────────────────────────────
  const companyName = entity.name
  const websiteUrl = entity.website_url

  // Build search queries
  const primaryQuery = `${companyName} company services specialties${websiteUrl ? ' site:' + new URL(websiteUrl).hostname : ''}`
  const secondaryQuery = `${companyName} construction real estate development projects clients`

  const allSources: Array<{ url: string; title?: string }> = []
  const rawTexts: string[] = []

  try {
    const primaryRes = await researchQuery(primaryQuery)
    rawTexts.push(primaryRes.text)
    allSources.push(...primaryRes.sources)
  } catch (err) {
    console.error('[entity-enrich] primary query failed', err)
  }

  try {
    const secondaryRes = await researchQuery(secondaryQuery)
    rawTexts.push(secondaryRes.text)
    allSources.push(...secondaryRes.sources)
  } catch (err) {
    console.error('[entity-enrich] secondary query failed', err)
  }

  // Structure the results
  let structured: StructuredEntityEnrichment = {}
  if (rawTexts.length > 0) {
    try {
      structured = await structureWithGemini(rawTexts, user.id)
    } catch (err) {
      console.error('[entity-enrich] structuring failed', err)
    }
  }

  // Build preview
  const preview: EntityEnrichmentPreview = {
    description: structured.description ?? null,
    specialties: structured.specialties ?? null,
    headquarters: structured.headquarters ?? null,
    website_url: entity.website_url ?? null,
    enrichment_notes: {
      services: structured.services ?? null,
      key_clients: structured.key_clients ?? null,
      founded_year: structured.founded_year ?? null,
      employee_count: structured.employee_count ?? null,
      certifications: structured.certifications ?? null,
      notable_projects: structured.notable_projects ?? null,
      government_contract_history: structured.government_contract_history ?? null,
    },
    sources: allSources.filter((s, i, arr) => arr.findIndex((x) => x.url === s.url) === i).slice(0, 20),
  }

  // Detect conflicts with existing data
  const currentScalars: Record<string, string | null> = {
    description: entity.description ?? null,
    headquarters: entity.headquarters ?? null,
  }
  const previewScalars: Record<string, string | null> = {
    description: preview.description,
    headquarters: preview.headquarters,
  }
  const conflicts = detectConflicts(currentScalars, previewScalars)

  return Response.json({
    preview,
    conflicts,
    current: {
      name: entity.name,
      description: entity.description ?? null,
      specialties: entity.specialties ?? [],
      headquarters: entity.headquarters ?? null,
      website_url: entity.website_url ?? null,
    },
  })
}
