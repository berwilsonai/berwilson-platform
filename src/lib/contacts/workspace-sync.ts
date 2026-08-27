/**
 * Push the `parties` directory into every mailbox's Google Contacts.
 *
 * Why this is worth doing at all: the directory is the CRM's most broadly
 * useful table and its least reachable one. A person composing a mail wants the
 * address to autocomplete; they are not going to open a tailnet-only app to
 * look it up, so today they type it from memory or dig through old threads.
 *
 * One-way and idempotent, in the same shape as the Drive publisher:
 *
 *  - **Change detection** is a content hash of exactly the fields pushed, so a
 *    party edited in a way the sync does not carry (a note, a tag change that
 *    is not in the biography) costs nothing on the next run.
 *  - **Per-mailbox resourceNames** live in `parties.google_contacts`, keyed by
 *    mailbox, because the same party is a different contact record in each
 *    account. A mailbox added later simply has no key and gets created on the
 *    first run after its consent.
 *  - **Retirement** is handled, not just creation: a party that is archived or
 *    loses its last contactable field is DELETED from the mailboxes it was
 *    pushed to. Otherwise the first stale row would sit in three people's
 *    contacts forever, and "the CRM put something wrong in my Gmail and won't
 *    take it back" is how an integration gets switched off.
 *
 * Nothing is ever read back. See google-contacts-write.ts for why.
 */

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'
import {
  ContactGoneError,
  ContactsScopeError,
  addToContactGroup,
  contactExists,
  createContact,
  deleteContact,
  ensureContactGroup,
  listGroupMembers,
  updateContact,
  type ContactPerson,
} from '@/lib/integrations/google-contacts-write'
import { allMailboxes, isGoogleConfigured } from '@/lib/integrations/google-workspace'

export interface ContactSyncResult {
  eligible: number
  created: number
  updated: number
  unchanged: number
  retired: number
  /** Contacts deleted by hand in a mailbox and put back. */
  restored: number
  failed: number
  skippedMailboxes: string[]
  errors: string[]
  outOfTime: boolean
}

interface PartyRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  company: string | null
  title: string | null
  is_organization: boolean | null
  tags: string[] | null
  status: string
  google_contacts: Json
  google_contacts_hash: string | null
}

/** Map of mailbox → Google resourceName for one party. */
type ContactMap = Record<string, string>

function readContactMap(value: Json): ContactMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ContactMap = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v
  }
  return out
}

/**
 * Is this party worth putting in someone's contacts?
 *
 * An entry with neither an address nor a number cannot help anyone compose
 * anything — it is a name that would clutter autocomplete and never complete.
 */
function isEligible(p: PartyRow): boolean {
  return p.status !== 'archived' && Boolean(p.email?.trim() || p.phone?.trim())
}

/**
 * Split a display name into given/family for a person.
 *
 * Organizations get an unstructured name instead: "Noir Capital Group LLC" has
 * no family name, and forcing one produces contacts that sort under "LLC".
 */
function nameFields(p: PartyRow): ContactPerson['names'] {
  const full = p.full_name.trim()
  if (p.is_organization) return [{ unstructuredName: full }]

  const parts = full.split(/\s+/)
  if (parts.length < 2) return [{ givenName: full, unstructuredName: full }]
  return [
    {
      givenName: parts.slice(0, -1).join(' '),
      familyName: parts[parts.length - 1],
      unstructuredName: full,
    },
  ]
}

export function buildPerson(p: PartyRow): ContactPerson {
  const tags = (p.tags ?? []).filter(Boolean)
  const noteLines = [
    'Synced from Ber Intelligence — edit the record there, not here.',
    ...(tags.length ? [`Tags: ${tags.join(', ')}`] : []),
  ]

  return {
    names: nameFields(p),
    ...(p.email?.trim() ? { emailAddresses: [{ value: p.email.trim() }] } : {}),
    ...(p.phone?.trim() ? { phoneNumbers: [{ value: p.phone.trim() }] } : {}),
    ...(p.company?.trim() || p.title?.trim()
      ? {
          organizations: [
            {
              ...(p.company?.trim() ? { name: p.company.trim() } : {}),
              ...(p.title?.trim() ? { title: p.title.trim() } : {}),
            },
          ],
        }
      : {}),
    biographies: [{ value: noteLines.join('\n'), contentType: 'TEXT_PLAIN' }],
    // Carries the party id back, so a contact in a mailbox can always be traced
    // to the row that produced it without consulting the database.
    userDefined: [{ key: 'Ber Intelligence ID', value: p.id }],
  }
}

/**
 * Hash exactly what gets pushed.
 *
 * Built from the assembled Person rather than the raw row so that a column
 * change which does not alter the contact (and there are several) does not
 * trigger three pointless API round trips per mailbox.
 */
export function contactHash(person: ContactPerson): string {
  return createHash('sha1').update(JSON.stringify(person)).digest('hex')
}

export async function syncContactsToWorkspace(
  opts: { budgetMs?: number } = {}
): Promise<ContactSyncResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 5 * 60 * 1000)
  const supabase = createAdminClient()

  const result: ContactSyncResult = {
    eligible: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    retired: 0,
    restored: 0,
    failed: 0,
    skippedMailboxes: [],
    errors: [],
    outOfTime: false,
  }

  if (!isGoogleConfigured()) {
    throw new Error('Google Workspace is not configured, so contacts cannot be synced.')
  }

  const { data, error } = await supabase
    .from('parties')
    .select(
      'id, full_name, email, phone, company, title, is_organization, tags, status, google_contacts, google_contacts_hash'
    )
  if (error) throw new Error(error.message)

  const parties = (data ?? []) as PartyRow[]

  // A mailbox whose consent predates the contacts scope fails identically for
  // every party, so it is dropped for the rest of the run after the first
  // failure rather than producing one error line per contact.
  const mailboxes = allMailboxes()
  const live = new Set(mailboxes)
  const groups = new Map<string, string>()

  // One listing per mailbox, up front. This is the only thing that catches a
  // contact deleted by hand in Gmail: the stored pointer and the stored hash
  // both still look clean, so without it the sync reports "unchanged" and that
  // person stays missing from the mailbox permanently. A null means the listing
  // failed and every pointer is assumed good — treating "could not look" as
  // "gone" would recreate the whole directory on one transient error.
  const memberSets = new Map<string, Set<string> | null>()
  for (const mailbox of mailboxes) {
    memberSets.set(mailbox, await listGroupMembers(mailbox))
  }

  const noteFail = (msg: string) => {
    result.failed++
    if (result.errors.length < 10) result.errors.push(msg)
  }

  for (const party of parties) {
    if (Date.now() > deadline) {
      result.outOfTime = true
      break
    }
    if (live.size === 0) break

    const existing = readContactMap(party.google_contacts)

    // --- retirement -------------------------------------------------------
    if (!isEligible(party)) {
      if (Object.keys(existing).length === 0) continue

      const remaining: ContactMap = {}
      for (const [mailbox, resourceName] of Object.entries(existing)) {
        if (!live.has(mailbox)) {
          remaining[mailbox] = resourceName
          continue
        }
        try {
          await deleteContact(mailbox, resourceName)
        } catch (err) {
          if (err instanceof ContactsScopeError) {
            live.delete(mailbox)
            result.skippedMailboxes.push(mailbox)
            remaining[mailbox] = resourceName
            continue
          }
          // Already gone is the outcome we wanted; anything else keeps the
          // pointer so the next run tries again.
          if (!(err instanceof ContactGoneError)) {
            remaining[mailbox] = resourceName
            noteFail(`${party.full_name}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }

      await supabase
        .from('parties')
        .update({
          google_contacts: remaining as unknown as Json,
          google_contacts_hash: null,
        })
        .eq('id', party.id)
      result.retired++
      continue
    }

    // --- create / update --------------------------------------------------
    result.eligible++

    // Drop pointers to contacts that are no longer in the mailbox, so the
    // create path below puts them back. A resourceName missing from the group
    // is only a SUSPECT — someone may have dragged the contact out of the group
    // while keeping it — so it is confirmed with a direct read before being
    // discarded. Recreating a contact that still exists would duplicate it,
    // which is worse than the problem being solved.
    for (const mailbox of [...live]) {
      const resourceName = existing[mailbox]
      const members = memberSets.get(mailbox)
      if (!resourceName || !members || members.has(resourceName)) continue

      try {
        if (!(await contactExists(mailbox, resourceName))) {
          delete existing[mailbox]
          result.restored++
        }
      } catch (err) {
        if (err instanceof ContactsScopeError) {
          live.delete(mailbox)
          result.skippedMailboxes.push(mailbox)
        }
        // Any other failure leaves the pointer alone: the next run tries again.
      }
    }

    const person = buildPerson(party)
    const hash = contactHash(person)
    const covered = [...live].every((m) => existing[m])
    if (hash === party.google_contacts_hash && covered) {
      result.unchanged++
      continue
    }

    const next: ContactMap = { ...existing }
    let touched = false
    let anyCreated = false

    for (const mailbox of [...live]) {
      const resourceName = next[mailbox]
      try {
        const group = groups.get(mailbox) ?? (await ensureContactGroup(mailbox))
        groups.set(mailbox, group)

        if (resourceName) {
          try {
            await updateContact(mailbox, resourceName, person)
            touched = true
            continue
          } catch (err) {
            // Deleted by hand in Gmail: fall through and recreate rather than
            // dropping this person out of the mailbox permanently.
            if (!(err instanceof ContactGoneError)) throw err
          }
        }

        const created = await createContact(mailbox, person)
        await addToContactGroup(mailbox, group, [created.resourceName])
        next[mailbox] = created.resourceName
        touched = true
        anyCreated = true
      } catch (err) {
        if (err instanceof ContactsScopeError) {
          live.delete(mailbox)
          result.skippedMailboxes.push(mailbox)
          continue
        }
        noteFail(`${party.full_name} → ${mailbox}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (!touched) continue

    // The hash is only stored when every live mailbox actually carries the
    // contact. Storing it after a partial failure would mark the party clean
    // and the missing mailbox would never be filled in.
    const complete = [...live].every((m) => next[m])
    await supabase
      .from('parties')
      .update({
        google_contacts: next as unknown as Json,
        google_contacts_hash: complete ? hash : null,
      })
      .eq('id', party.id)

    if (anyCreated) result.created++
    else result.updated++
  }

  result.skippedMailboxes = [...new Set(result.skippedMailboxes)]
  return result
}
