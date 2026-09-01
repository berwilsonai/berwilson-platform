/**
 * POST /api/contacts/scan-card/confirm
 *
 * Body: { draft: CardScanDraft } → creates the contact.
 *
 * Separate from the scan step because a scan must never create a record on its
 * own: OCR misreads, and the AI's fit read is a judgement a human signs off.
 * The reviewer's edits are what land here.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { embedPartyEnrichment } from '@/lib/ai/embeddings'
import type { CardScanDraft } from '@/lib/contacts/card-intake'
import type { Json } from '@/lib/supabase/types'

export const maxDuration = 120

function str(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim() : ''
  return t ? t : null
}

/** The human-readable record of the meeting, shown on the contact page. */
function composeNotes(draft: Partial<CardScanDraft>): string | null {
  const scanned = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const parts = [`Added from a business card scanned ${scanned}.`]
  if (str(draft.company_summary)) parts.push(`**What they do:** ${draft.company_summary!.trim()}`)
  if (str(draft.fit_notes)) parts.push(`**Possible fit for Ber Wilson:** ${draft.fit_notes!.trim()}`)
  return parts.join('\n\n')
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { draft?: Partial<CardScanDraft> }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const draft = body.draft
  if (!draft) return Response.json({ error: 'Missing draft.' }, { status: 400 })

  const full_name = str(draft.full_name)
  const company = str(draft.company)
  // A card with only a company on it is a real card — fall back to the company
  // as an organization record rather than rejecting the scan.
  const isOrg = !full_name && Boolean(company)
  const name = full_name ?? company
  if (!name) {
    return Response.json({ error: 'A name or company is required to create a contact.' }, { status: 400 })
  }

  const tags = [...new Set(
    (Array.isArray(draft.tags) ? draft.tags : [])
      .map((t) => String(t).trim().toLowerCase())
      .filter(Boolean),
  )]

  const admin = await actorAdminClient()

  const { data: created, error } = await admin
    .from('parties')
    .insert({
      full_name: name,
      company: isOrg ? null : company,
      title: str(draft.title),
      email: str(draft.email),
      phone: str(draft.phone),
      linkedin_url: null,
      is_organization: isOrg,
      tags,
      status: 'active',
      relationship_notes: composeNotes(draft),
      enrichment_notes: {
        source: 'business_card_scan',
        scanned_at: new Date().toISOString(),
        address: str(draft.address),
        website: str(draft.website),
        company_summary: str(draft.company_summary),
        fit_notes: str(draft.fit_notes),
        // The recognized text is kept; the photograph it came from is not.
        raw_text: str(draft.raw_text),
        sources: Array.isArray(draft.sources) ? draft.sources : [],
      } as unknown as Json,
    })
    .select('id')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Link the person to their firm in the vendor directory (find-or-create),
  // mirroring the manual Add Contact flow so both doors produce the same shape.
  if (company && !isOrg) {
    try {
      const { data: existing } = await admin
        .from('entities')
        .select('id')
        .ilike('name', company)
        .limit(1)
        .maybeSingle()

      let entityId = existing?.id ?? null
      if (!entityId) {
        const { data: newEntity } = await admin
          .from('entities')
          .insert({
            name: company,
            entity_type: 'other' as const,
            website_url: str(draft.website),
            description: str(draft.company_summary),
          })
          .select('id')
          .single()
        entityId = newEntity?.id ?? null
      }

      if (entityId) {
        await admin
          .from('party_entities')
          .insert({ party_id: created.id, entity_id: entityId, role: 'employee', is_primary: true })
      }
    } catch (err) {
      // A directory link is a nicety; never fail a contact that already exists.
      console.error('[scan-card] company link failed', err)
    }
  }

  // Make the contact answerable by Ber AI ("who did I meet who does X?").
  embedPartyEnrichment(created.id).catch(console.error)

  return Response.json({ id: created.id })
}
