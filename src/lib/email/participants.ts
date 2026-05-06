/**
 * Tier 1 contact resolution: auto-create contacts for every person
 * in the From/To/CC fields of an email.
 *
 * New contacts land in pending_review status and are queued for manual
 * confirmation before appearing in the CRM. Existing contacts are untouched.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { GraphMessage } from '@/lib/integrations/microsoft-graph'

/** Inbox addresses we own — never create a contact for these */
const OWN_ADDRESSES = new Set(['info@berwilson.com'])

interface Participant {
  name: string
  email: string
}

function collectParticipants(message: GraphMessage): Participant[] {
  const seen = new Set<string>()
  const participants: Participant[] = []

  const add = (r: { emailAddress: { name: string; address: string } }) => {
    const email = r.emailAddress.address.toLowerCase().trim()
    if (!email || OWN_ADDRESSES.has(email) || seen.has(email)) return
    seen.add(email)
    // Fall back to the local part of the address if Graph doesn't provide a display name
    const name = r.emailAddress.name?.trim() || email.split('@')[0]
    participants.push({ name, email })
  }

  add(message.from)
  message.toRecipients.forEach(add)
  message.ccRecipients.forEach(add)

  return participants
}

/**
 * For every real person on the email thread (From / To / CC), ensure a
 * party record exists in the database.  Existing records are never modified.
 */
export async function resolveEmailParticipants(message: GraphMessage): Promise<void> {
  const participants = collectParticipants(message)
  if (participants.length === 0) return

  const supabase = createAdminClient()

  // Find which email addresses already have a contact record
  const { data: existing } = await supabase
    .from('parties')
    .select('email')
    .in('email', participants.map((p) => p.email))

  const existingEmails = new Set(
    (existing ?? []).map((p) => p.email?.toLowerCase()).filter(Boolean)
  )

  const toCreate = participants.filter((p) => !existingEmails.has(p.email))
  if (toCreate.length === 0) return

  // Cast to bypass generated types — status column added via migration
  const db = supabase as unknown as import('@supabase/supabase-js').SupabaseClient

  const { data: created, error } = await db
    .from('parties')
    .insert(
      toCreate.map((p) => ({
        full_name: p.name,
        email: p.email,
        is_organization: false,
        status: 'pending_review',
      }))
    )
    .select('id, email')

  if (error) {
    // Non-fatal — log and continue
    console.error('[participants] Failed to auto-create contacts:', error.message)
    return
  }

  console.log(
    `[participants] Auto-created ${toCreate.length} contact(s) in review queue: ${toCreate.map((p) => p.email).join(', ')}`
  )

  // Queue each new contact for manual confirmation
  if (created && created.length > 0) {
    const queueItems = (created as Array<{ id: string; email: string }>).map((c) => ({
      source_table: 'parties',
      record_id: c.id,
      project_id: null,
      reason: 'new_contact',
      confidence: null,
      ai_explanation: `Auto-detected from email (${c.email}). Confirm this is a real project contact before it appears in your CRM.`,
    }))

    const { error: queueError } = await db.from('review_queue').insert(queueItems)
    if (queueError) {
      console.error('[participants] Failed to queue contacts for review:', queueError.message)
    }
  }
}
