/**
 * Google Contacts (People API) writes — the platform's directory, pushed into
 * each mailbox's saved contacts.
 *
 * The reason this exists is the same reason the Gmail labels and the Drive
 * folders exist: **Ber Intelligence is tailnet-only, and most of the company
 * cannot reach it.** A counterparty the CRM knows everything about is, to
 * someone composing a mail, a name they have to remember and type in full.
 * Syncing the directory out means the CRM helps a person who never opens it.
 *
 * One-way, exactly like the Drive publisher. Nothing is ever read back from a
 * mailbox's contacts into `parties` — that would make Gmail a second source of
 * truth for the directory, and reconciling two of those is the failure this
 * whole integration layer is shaped to avoid. (Party ENRICHMENT reads contacts,
 * but it reads them as one advisory source among several and a human confirms;
 * that is a different thing from a sync.)
 *
 * Every contact written here is put in a **contact group** named after the
 * platform. Without it, dozens of rows land in someone's personal contacts with
 * nothing to distinguish them from the ones they added themselves — which is
 * how an integration earns a reputation for making a mess. With it, the whole
 * push is visible in one place and reversible in one action.
 *
 * Requires the `contacts` scope (read+write), which is in SCOPES and therefore
 * granted on every mailbox. A stored token predating it fails with a message
 * naming the re-consent, and callers treat that as a skip.
 */

import { explainTokenError, getAccessToken } from './google-workspace'

const PEOPLE_BASE = 'https://people.googleapis.com/v1'

/** The contact group every synced party is filed under, in every mailbox. */
export const CONTACT_GROUP_NAME = 'Ber Intelligence'

/**
 * Fields the sync owns and therefore overwrites on update.
 *
 * Deliberately narrow. Anything absent here is left exactly as the human left
 * it — so someone who adds a birthday or a second phone number in Gmail keeps
 * it, and the sync only ever asserts the facts the CRM is actually the
 * authority for.
 */
const OWNED_FIELDS = [
  'names',
  'emailAddresses',
  'phoneNumbers',
  'organizations',
  'biographies',
  'userDefined',
] as const

/** Thrown when the mailbox's stored consent predates the `contacts` scope. */
export class ContactsScopeError extends Error {
  constructor(mailbox: string) {
    super(
      `${mailbox} has not granted the contacts scope, so the directory cannot be synced into it. ` +
        `Re-consent that mailbox with: node scripts/setup-google-oauth.mjs --only ${mailbox}`
    )
    this.name = 'ContactsScopeError'
  }
}

/** Thrown when Google says the contact is gone — the caller recreates it. */
export class ContactGoneError extends Error {
  constructor(resourceName: string) {
    super(`Contact ${resourceName} no longer exists.`)
    this.name = 'ContactGoneError'
  }
}

async function peopleCall<T>(
  mailbox: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown
): Promise<T> {
  const token = await getAccessToken(mailbox)
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    // A contact deleted by hand in Gmail is a normal state, not a fault: the
    // stored resourceName is simply stale and the caller recreates. It has to
    // be distinguishable from a real failure or the sync would either crash on
    // it or silently stop maintaining that person forever.
    if (res.status === 404) throw new ContactGoneError(url)
    // 403 here is nearly always the missing scope rather than a real denial,
    // and the two read identically in Google's response.
    if (res.status === 403 || /[Ii]nsufficient/.test(err)) {
      throw new ContactsScopeError(mailbox)
    }
    const path = url.split('?')[0].replace(/https:\/\/[^/]+/, '')
    throw new Error(`People ${path} on ${mailbox} failed: ${res.status} — ${explainTokenError(err)}`)
  }

  // DELETE returns an empty body; JSON.parse of "" throws.
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

// ---------------------------------------------------------------------------
// Contact group
// ---------------------------------------------------------------------------

interface ContactGroupRaw {
  resourceName: string
  name?: string
  formattedName?: string
}

/** Group resourceNames are stable; resolving once per process is plenty. */
const groupCache = new Map<string, string>()

/**
 * Resolve the platform's contact group in a mailbox, creating it if absent.
 *
 * Looked up by name rather than stored, unlike the Drive folders — a contact
 * group name is unique within an account, so the ambiguity that forced Drive to
 * create-not-find does not exist here.
 */
export async function ensureContactGroup(mailbox: string): Promise<string> {
  const cached = groupCache.get(mailbox)
  if (cached) return cached

  const listed = await peopleCall<{ contactGroups?: ContactGroupRaw[] }>(
    mailbox,
    'GET',
    `${PEOPLE_BASE}/contactGroups?pageSize=200`
  )
  const existing = (listed.contactGroups ?? []).find(
    (g) => (g.formattedName ?? g.name) === CONTACT_GROUP_NAME
  )
  if (existing) {
    groupCache.set(mailbox, existing.resourceName)
    return existing.resourceName
  }

  const created = await peopleCall<ContactGroupRaw>(
    mailbox,
    'POST',
    `${PEOPLE_BASE}/contactGroups`,
    { contactGroup: { name: CONTACT_GROUP_NAME } }
  )
  groupCache.set(mailbox, created.resourceName)
  return created.resourceName
}

/**
 * File contacts into the group.
 *
 * A separate call from the create rather than a `memberships` field on the
 * Person: membership is modelled by Google as a property of the GROUP, and
 * setting it through the person body is not reliably honoured.
 */
export async function addToContactGroup(
  mailbox: string,
  groupResourceName: string,
  contactResourceNames: string[]
): Promise<void> {
  if (contactResourceNames.length === 0) return
  await peopleCall(
    mailbox,
    'POST',
    `${PEOPLE_BASE}/${groupResourceName}/members:modify`,
    { resourceNamesToAdd: contactResourceNames }
  )
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/** The subset of a Google Person this platform ever writes. */
export interface ContactPerson {
  names?: { givenName?: string; familyName?: string; unstructuredName?: string }[]
  emailAddresses?: { value: string }[]
  phoneNumbers?: { value: string }[]
  organizations?: { name?: string; title?: string }[]
  biographies?: { value: string; contentType: 'TEXT_PLAIN' }[]
  userDefined?: { key: string; value: string }[]
}

export interface ContactRef {
  resourceName: string
  etag: string
}

export async function createContact(
  mailbox: string,
  person: ContactPerson
): Promise<ContactRef> {
  const created = await peopleCall<ContactRef>(
    mailbox,
    'POST',
    `${PEOPLE_BASE}/people:createContact`,
    person
  )
  return { resourceName: created.resourceName, etag: created.etag }
}

/**
 * Overwrite the owned fields of an existing contact.
 *
 * Google requires the current etag on the body and rejects a stale one, which
 * is a concurrency guard: if a human edited the contact in Gmail since we last
 * looked, our stored etag is stale and the write fails rather than silently
 * clobbering their edit. So the etag is fetched immediately before the write
 * rather than cached — the extra round trip IS the safety.
 */
export async function updateContact(
  mailbox: string,
  resourceName: string,
  person: ContactPerson
): Promise<ContactRef> {
  const current = await peopleCall<{ etag: string }>(
    mailbox,
    'GET',
    `${PEOPLE_BASE}/${resourceName}?personFields=names`
  )

  const updated = await peopleCall<ContactRef>(
    mailbox,
    'PATCH',
    `${PEOPLE_BASE}/${resourceName}:updateContact?updatePersonFields=${OWNED_FIELDS.join(',')}`,
    { ...person, etag: current.etag }
  )
  return { resourceName: updated.resourceName, etag: updated.etag }
}

export async function deleteContact(mailbox: string, resourceName: string): Promise<void> {
  await peopleCall(mailbox, 'DELETE', `${PEOPLE_BASE}/${resourceName}:deleteContact`)
}

/** Does this contact still exist? Used to confirm a suspected deletion. */
export async function contactExists(mailbox: string, resourceName: string): Promise<boolean> {
  try {
    await peopleCall(mailbox, 'GET', `${PEOPLE_BASE}/${resourceName}?personFields=names`)
    return true
  } catch (err) {
    if (err instanceof ContactGoneError) return false
    throw err
  }
}

/**
 * Every contact currently filed under the platform's group in a mailbox.
 *
 * One call per mailbox regardless of directory size, which is what makes it
 * affordable to check on every run. It exists to catch the case a content hash
 * structurally cannot: a contact deleted by hand in Gmail leaves the stored
 * pointer and the stored hash both looking perfectly clean, so the sync would
 * report "unchanged" and that person would be missing from the mailbox forever.
 *
 * Returns null when the listing itself fails — the caller must treat "I could
 * not look" as "assume present", or one transient error would recreate the
 * entire directory.
 */
export async function listGroupMembers(mailbox: string): Promise<Set<string> | null> {
  try {
    const group = await ensureContactGroup(mailbox)
    const data = await peopleCall<{ memberResourceNames?: string[] }>(
      mailbox,
      'GET',
      `${PEOPLE_BASE}/${group}?maxMembers=1000`
    )
    return new Set(data.memberResourceNames ?? [])
  } catch {
    return null
  }
}
