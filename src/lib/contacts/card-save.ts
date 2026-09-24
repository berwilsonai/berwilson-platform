/**
 * The one write path for a scanned business card — used by the single scan's
 * confirm and by the batch confirm alike.
 *
 * It exists because there are now two doors onto the same act. A forked copy
 * would have drifted: one door linking the employer in the vendor directory and
 * the other not, one embedding the contact for Ber AI and the other leaving it
 * unanswerable. (§12: never fork a shared pass — add a target.)
 *
 * Three actions, decided by the human on the review screen, never by the model:
 *   create — a new contact
 *   link   — fill in the contact the directory already holds, never overwriting
 *            a field a person typed; the card only supplies what is missing
 *   skip   — nothing at all
 */

import { embedPartyEnrichment } from '@/lib/ai/embeddings'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { CardScanDraft } from '@/lib/contacts/card-intake'
import type { Json, TablesUpdate } from '@/lib/supabase/types'

export type CardAction = 'create' | 'link' | 'skip'

export interface CardSaveResult {
  id: string
  /** What actually happened, for the message the reviewer reads afterwards. */
  action: 'created' | 'linked'
}

/**
 * The caller supplies the client, and supplies an ACTOR one (`actorAdminClient`)
 * — a user-initiated write attributed to "system" in the activity log is the
 * §12 bug. Taking it as a parameter also keeps this module free of
 * request-scoped imports, so a background pass could call it.
 */
type Db = ReturnType<typeof createAdminClient>

export function str(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim() : ''
  return t ? t : null
}

/** The human-readable record of the meeting, shown on the contact page. */
export function composeCardNotes(draft: Partial<CardScanDraft>): string | null {
  const scanned = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const parts = [`Added from a business card scanned ${scanned}.`]
  if (str(draft.company_summary)) parts.push(`**What they do:** ${draft.company_summary!.trim()}`)
  if (str(draft.fit_notes)) parts.push(`**Possible fit for Ber Wilson:** ${draft.fit_notes!.trim()}`)
  return parts.join('\n\n')
}

function cardEnrichment(draft: Partial<CardScanDraft>): Json {
  return {
    source: 'business_card_scan',
    scanned_at: new Date().toISOString(),
    address: str(draft.address),
    website: str(draft.website),
    company_summary: str(draft.company_summary),
    fit_notes: str(draft.fit_notes),
    // The recognized text is kept; the photograph it came from is not.
    raw_text: str(draft.raw_text),
    sources: Array.isArray(draft.sources) ? draft.sources : [],
  } as unknown as Json
}

/**
 * Link a person to their firm in the vendor directory (find-or-create), the
 * same shape People Intake and manual Add Contact produce — so every door
 * leaves the directory looking the same. A directory link is a nicety: it never
 * fails a contact that already exists.
 */
async function linkEmployer(db: Db, partyId: string, company: string, draft: Partial<CardScanDraft>) {
  try {
    const { data: existing } = await db
      .from('entities')
      .select('id')
      .ilike('name', company)
      .limit(1)
      .maybeSingle()

    let entityId = existing?.id ?? null
    if (!entityId) {
      const { data: created } = await db
        .from('entities')
        .insert({
          name: company,
          entity_type: 'other' as const,
          website_url: str(draft.website),
          description: str(draft.company_summary),
        })
        .select('id')
        .single()
      entityId = created?.id ?? null
    }
    if (!entityId) return

    // Idempotent: re-confirming a batch must not double-link.
    const { data: link } = await db
      .from('party_entities')
      .select('id')
      .eq('party_id', partyId)
      .eq('entity_id', entityId)
      .limit(1)
      .maybeSingle()
    if (link) return

    await db
      .from('party_entities')
      .insert({ party_id: partyId, entity_id: entityId, role: 'employee', is_primary: true })
  } catch (err) {
    console.error('[card-save] company link failed', err)
  }
}

/**
 * Create the contact, or fill in the one already on file.
 *
 * Throws with a message fit to show the reviewer — the batch confirm catches
 * per card, so one bad row never costs the reader the other eleven.
 */
export async function saveCardContact(
  draft: Partial<CardScanDraft>,
  action: Exclude<CardAction, 'skip'>,
  admin: Db
): Promise<CardSaveResult> {

  const full_name = str(draft.full_name)
  const company = str(draft.company)
  // A card with only a company on it is a real card — fall back to the company
  // as an organization record rather than rejecting the scan.
  const isOrg = !full_name && Boolean(company)
  const name = full_name ?? company
  if (!name) throw new Error('A name or company is required to create a contact.')

  const tags = [...new Set(
    (Array.isArray(draft.tags) ? draft.tags : [])
      .map((t) => String(t).trim().toLowerCase())
      .filter(Boolean),
  )]

  if (action === 'link') {
    const targetId = str(draft.existing_party_id)
    if (!targetId) throw new Error('No existing contact was chosen to link to.')

    const { data: current, error: readErr } = await admin
      .from('parties')
      .select('id, full_name, company, title, email, phone, relationship_notes, tags, enrichment_notes')
      .eq('id', targetId)
      .single()
    if (readErr || !current) throw new Error('That contact no longer exists.')

    // Only ever fill a blank. A value already on the record was put there by a
    // person or by a richer pass than a photograph of a card.
    const patch: TablesUpdate<'parties'> = {}
    if (!current.company && company && !isOrg) patch.company = company
    if (!current.title && str(draft.title)) patch.title = str(draft.title)
    if (!current.email && str(draft.email)) patch.email = str(draft.email)
    if (!current.phone && str(draft.phone)) patch.phone = str(draft.phone)

    const mergedTags = [...new Set([...(current.tags ?? []), ...tags])]
    if (mergedTags.length !== (current.tags ?? []).length) patch.tags = mergedTags

    const notes = composeCardNotes(draft)
    if (notes) {
      patch.relationship_notes = current.relationship_notes
        ? `${current.relationship_notes}\n\n---\n\n${notes}`
        : notes
    }

    const prior = (current.enrichment_notes ?? {}) as Record<string, unknown>
    patch.enrichment_notes = { ...prior, business_card: cardEnrichment(draft) } as unknown as Json

    const { error } = await admin.from('parties').update(patch).eq('id', targetId)
    if (error) throw new Error(error.message)

    if (company && !isOrg) await linkEmployer(admin, targetId, company, draft)
    embedPartyEnrichment(targetId).catch(console.error)
    return { id: targetId, action: 'linked' }
  }

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
      relationship_notes: composeCardNotes(draft),
      enrichment_notes: cardEnrichment(draft),
    })
    .select('id')
    .single()

  if (error || !created) throw new Error(error?.message ?? 'Could not create the contact.')

  if (company && !isOrg) await linkEmployer(admin, created.id, company, draft)

  // Make the contact answerable by Ber AI ("who did I meet who does X?").
  embedPartyEnrichment(created.id).catch(console.error)

  return { id: created.id, action: 'created' }
}
