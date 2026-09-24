/**
 * POST /api/contacts/profile-intake/confirm
 *
 * The only write path for People Intake. Takes the reviewer's edited rows and
 * lands them: contacts created or filled in, aliases mapped, employers linked
 * in the vendor directory, and everyone attached to the deal as a player.
 *
 * Separate from the run step because a profile read out of mail is evidence,
 * not a record. The run stages; a human signs off; this writes. Nothing in the
 * mail pipeline has ever been allowed to create a record on its own and this
 * does not change that.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { actorAdminClient, getViewer, canAccessRecord, forbiddenJson } from '@/lib/auth/viewer'
import { embedPartyEnrichment } from '@/lib/ai/embeddings'
import { upsertAliases } from '@/lib/contacts/aliases'
import type { ProfileIntakeDraft, PersonProfileDraft } from '@/lib/contacts/profile-intake'
import type { Json, TablesInsert, TablesUpdate } from '@/lib/supabase/types'
import type { SupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 120

/** One reviewed row, as the review screen submits it. */
interface PersonAction {
  ref: string
  action: 'create' | 'link' | 'skip'
  existing_party_id?: string | null
  full_name?: string | null
  email?: string | null
  title?: string | null
  company?: string | null
  phone?: string | null
  linkedin_url?: string | null
  role?: string | null
  is_organization?: boolean
  /** Attach to the chosen record as a player. */
  link_to_record?: boolean
  aliases?: string[]
}

interface ConfirmBody {
  session_id?: string
  /** The deal everyone lands on. Omitted = contacts only, no player links. */
  target?: { kind: 'project' | 'opportunity'; id: string } | null
  people?: PersonAction[]
}

function str(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim() : ''
  return t ? t : null
}

/** The contact page's record of where this came from and what the mail showed. */
function composeNotes(draft: PersonProfileDraft | undefined, role: string | null): string | null {
  if (!draft) return null
  const when = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const parts: string[] = []
  const evidence =
    draft.thread_count > 0
      ? `${draft.thread_count} email thread${draft.thread_count === 1 ? '' : 's'}`
      : draft.evidence === 'web'
      ? 'web research only'
      : draft.evidence === 'directory'
      ? 'Google Contacts only'
      : 'no correspondence found'
  parts.push(`Profiled from ${evidence} on ${when}.`)
  if (role) parts.push(`**Role on this deal:** ${role}`)
  if (draft.summary) parts.push(`**What the correspondence shows:** ${draft.summary}`)
  if (draft.commitments.length > 0) {
    parts.push(`**Outstanding in the mail:**\n${draft.commitments.map((c) => `• ${c}`).join('\n')}`)
  }
  if (draft.works_with.length > 0) parts.push(`**Appears alongside:** ${draft.works_with.join(', ')}`)
  return parts.join('\n\n')
}

/** Everything the mail and web found, kept whole under the contact. */
function composeEnrichment(draft: PersonProfileDraft | undefined): Json | null {
  if (!draft) return null
  return {
    source: 'people_intake',
    profiled_at: new Date().toISOString(),
    evidence: draft.evidence,
    thread_count: draft.thread_count,
    first_seen: draft.first_seen,
    last_seen: draft.last_seen,
    threads: draft.threads.map((t) => ({ subject: t.subject, last_at: t.last_at, mailbox: t.mailbox })),
    summary: draft.summary,
    commitments: draft.commitments,
    works_with: draft.works_with,
    role: draft.role,
    sources: draft.sources,
    researched: draft.researched,
  } as unknown as Json
}

/**
 * Link a person to their firm in the vendor directory (find-or-create), the
 * same shape the business-card scanner and manual Add Contact produce — so all
 * three doors leave the directory looking the same.
 */
async function linkEmployer(
  db: Awaited<ReturnType<typeof actorAdminClient>>,
  partyId: string,
  company: string
): Promise<void> {
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
        .insert({ name: company, entity_type: 'other' as const })
        .select('id')
        .single()
      entityId = created?.id ?? null
    }
    if (!entityId) return

    // Idempotent: re-confirming a session must not double-link.
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
    // A directory link is a nicety; never fail a contact that already exists.
    console.error('[people-intake] employer link failed:', err)
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: ConfirmBody
  try {
    body = (await request.json()) as ConfirmBody
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const sessionId = str(body.session_id)
  if (!sessionId) return Response.json({ error: 'session_id is required.' }, { status: 400 })

  const db = await actorAdminClient()

  const { data: session } = await db
    .from('email_intake_sessions')
    .select('id, label, extraction_result, status')
    .eq('id', sessionId)
    .eq('intake_kind', 'people')
    .single()

  if (!session) return Response.json({ error: 'Session not found.' }, { status: 404 })
  if (session.status === 'confirmed') {
    return Response.json({ error: 'This session was already confirmed.' }, { status: 409 })
  }

  const target = body.target ?? null
  if (target) {
    if (target.kind !== 'project' && target.kind !== 'opportunity') {
      return Response.json({ error: 'target.kind must be project or opportunity.' }, { status: 400 })
    }
    const viewer = await getViewer()
    if (!viewer || !(await canAccessRecord(viewer, target.kind, target.id))) return forbiddenJson()
  }

  const draft = (session.extraction_result ?? {}) as unknown as ProfileIntakeDraft
  const byRef = new Map((draft.people ?? []).map((p) => [p.ref, p]))

  const created: string[] = []
  const updated: string[] = []
  const linked: string[] = []
  const failures: string[] = []

  for (const action of body.people ?? []) {
    if (action.action === 'skip') continue

    const source = byRef.get(action.ref)
    const fullName = str(action.full_name) ?? source?.full_name ?? null
    const company = str(action.company)
    const role = str(action.role) ?? 'Contact'
    const isOrg = action.is_organization === true

    let partyId: string | null = null

    if (action.action === 'link') {
      partyId = str(action.existing_party_id)
      if (!partyId) {
        failures.push(`${fullName ?? action.ref}: no contact was chosen to link to.`)
        continue
      }

      // Fill the gaps on the existing contact; never overwrite a typed value.
      // Same policy as Enrich Profile — a human's entry outranks an extraction.
      const { data: current } = await db
        .from('parties')
        .select('id, full_name, email, title, company, phone, linkedin_url, relationship_notes')
        .eq('id', partyId)
        .single()
      if (!current) {
        failures.push(`${fullName ?? action.ref}: that contact no longer exists.`)
        continue
      }

      const patch: TablesUpdate<'parties'> = {}
      const fills: Array<[keyof TablesUpdate<'parties'>, string | null]> = [
        ['email', str(action.email)],
        ['title', str(action.title)],
        ['company', company],
        ['phone', str(action.phone)],
        ['linkedin_url', str(action.linkedin_url)],
      ]
      for (const [field, value] of fills) {
        if (value && !(current as Record<string, unknown>)[field]) {
          (patch as Record<string, unknown>)[field] = value
        }
      }
      const notes = composeNotes(source, role)
      if (notes) {
        // Appended, not replaced: the existing note is somebody's own writing.
        patch.relationship_notes = current.relationship_notes
          ? `${current.relationship_notes}\n\n---\n\n${notes}`
          : notes
      }
      const enrichment = composeEnrichment(source)
      if (enrichment) patch.enrichment_notes = enrichment
      patch.perplexity_enriched_at = new Date().toISOString()

      const { error } = await db.from('parties').update(patch).eq('id', partyId)
      if (error) {
        failures.push(`${fullName ?? action.ref}: ${error.message}`)
        continue
      }
      updated.push(partyId)
    } else {
      if (!fullName) {
        failures.push(`${action.ref}: a name is required to create a contact.`)
        continue
      }
      const row: TablesInsert<'parties'> = {
        full_name: fullName,
        email: str(action.email),
        title: str(action.title),
        company: isOrg ? null : company,
        phone: str(action.phone),
        linkedin_url: str(action.linkedin_url),
        is_organization: isOrg,
        status: 'active',
        tags: ['people-intake'],
        relationship_notes: composeNotes(source, role),
      }
      const enrichment = composeEnrichment(source)
      if (enrichment) row.enrichment_notes = enrichment

      const { data, error } = await db.from('parties').insert(row).select('id').single()
      if (error || !data) {
        failures.push(`${fullName}: ${error?.message ?? 'could not be created'}`)
        continue
      }
      partyId = data.id
      created.push(partyId)
    }

    if (!partyId) continue

    // Other spellings of the name, so the next extraction resolves rather than
    // duplicating — "Jerren Davis" where the address says Jaren.
    const aliases = action.aliases ?? source?.aliases ?? []
    if (aliases.length > 0 && fullName) {
      await upsertAliases(db as unknown as SupabaseClient, partyId, fullName, aliases)
    }

    if (company && !isOrg) await linkEmployer(db, partyId, company)

    // The deal association — the half of this that a contact record alone
    // cannot give you.
    if (target && action.link_to_record !== false) {
      const { data: existingPlayer } = await db
        .from('project_players')
        .select('id')
        .eq('party_id', partyId)
        .eq(target.kind === 'project' ? 'project_id' : 'opportunity_id', target.id)
        .limit(1)
        .maybeSingle()

      if (!existingPlayer) {
        const { error } = await db.from('project_players').insert({
          project_id: target.kind === 'project' ? target.id : null,
          opportunity_id: target.kind === 'opportunity' ? target.id : null,
          party_id: partyId,
          role,
        })
        if (error) failures.push(`${fullName ?? partyId}: could not be linked to the deal (${error.message}).`)
        else linked.push(partyId)
      } else {
        linked.push(partyId)
      }
    }

    // Make the contact answerable by Ber AI ("who is the land owner on Eagle
    // Mountain?"). Fire-and-forget — an embedding must not fail a confirm.
    embedPartyEnrichment(partyId).catch(console.error)
  }

  const { error: closeErr } = await db
    .from('email_intake_sessions')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      created_record_ids: {
        party_ids: [...created, ...updated],
        created_party_ids: created,
        updated_party_ids: updated,
        linked_party_ids: linked,
        target,
      } as unknown as Json,
    })
    .eq('id', sessionId)
  if (closeErr) console.error('[people-intake] could not close session:', closeErr.message)

  return Response.json({
    created: created.length,
    updated: updated.length,
    linked: linked.length,
    party_ids: [...created, ...updated],
    failures,
  })
}
