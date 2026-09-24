/**
 * POST /api/parties/[id]/enrich
 *
 * Two-step enrichment pipeline:
 *   1. Google People API — query the mailbox's contacts by email
 *   2. Gemini grounded search — person + company queries → structured extraction
 *
 * Body: {} → returns preview (does NOT save)
 * Body: { confirm: true, enriched: {...} } → saves to DB
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedPartyEnrichment } from '@/lib/ai/embeddings'
import {
  lookupDirectoryContact,
  directoryPhone,
  researchPersonWeb,
  type DirectoryContactResult,
} from '@/lib/contacts/web-enrichment'
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
  directory_done: boolean
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
  let directoryResult: DirectoryContactResult | null = null
  if (party.email) directoryResult = await lookupDirectoryContact(party.email)
  const directoryDone = directoryResult !== null

  const web = await researchPersonWeb({
    fullName: party.full_name,
    company: directoryResult?.companyName ?? party.company,
    userId: user.id,
  })
  const structured = web.structured

  // Build preview
  const preview: EnrichmentPreview = {
    linkedin_url: structured.linkedin_url ?? null,
    title: directoryResult?.jobTitle ?? null,
    company: directoryResult?.companyName ?? null,
    full_name: directoryResult?.displayName ?? null,
    phone: directoryPhone(directoryResult) ?? structured.phone ?? null,
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
    sources: web.sources,
    directory_done: directoryDone,
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
