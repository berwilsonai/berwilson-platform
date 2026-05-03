/**
 * Tier 1 contact resolution: auto-create contacts for every person
 * in the From/To/CC fields of an email.
 *
 * Email addresses are ground truth — no review needed.
 * Existing contacts (matched by email) are left untouched.
 * New addresses get a party record created automatically.
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

  const { error } = await supabase.from('parties').insert(
    toCreate.map((p) => ({
      full_name: p.name,
      email: p.email,
      is_organization: false,
    }))
  )

  if (error) {
    // Non-fatal — log and continue
    console.error('[participants] Failed to auto-create contacts:', error.message)
  } else {
    console.log(
      `[participants] Auto-created ${toCreate.length} contact(s): ${toCreate.map((p) => p.email).join(', ')}`
    )
  }
}
