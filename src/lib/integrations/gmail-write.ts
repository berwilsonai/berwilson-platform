/**
 * Gmail writes — labels and drafts, on the lead mailbox only.
 *
 * Everything else this platform does with mail is read-only by design. These
 * two writes exist for one reason: **most of the team cannot reach the tailnet**,
 * so anything that lives only inside Ber Intelligence is, for them, invisible.
 * Gmail they already have open.
 *
 *  - A **label** puts the triage verdict on the thread itself, so lead status is
 *    legible in the mailbox without a login, and the marketing filter becomes
 *    auditable in place rather than only inside /leads.
 *  - A **draft** puts a written reply in front of a human who then edits and
 *    sends it. The platform never sends it. That is not a limitation to remove
 *    later — a draft is human-gated by construction, which is exactly how the
 *    "mail never becomes an action without human review" invariant survives a
 *    feature that writes into the mailbox.
 *
 * Requires `gmail.modify`, which is granted on LEAD_MAILBOXES alone (see
 * LEAD_ONLY_SCOPES). A mailbox whose stored token predates that scope fails
 * here with a message naming the re-consent, and every caller treats that as a
 * skip rather than an error — the leads are safe in the queue either way.
 */

import {
  GMAIL_BASE,
  buildRawMessage,
  explainTokenError,
  getAccessToken,
} from './google-workspace'

/** Thrown when the mailbox's stored consent predates gmail.modify. */
export class GmailScopeError extends Error {
  constructor(mailbox: string) {
    super(
      `${mailbox} has not granted the gmail.modify scope, so the platform cannot label or draft in it. ` +
        `Re-consent that mailbox with: node scripts/setup-google-oauth.mjs --only ${mailbox}`
    )
    this.name = 'GmailScopeError'
  }
}

async function gmailWrite<T>(
  mailbox: string,
  path: string,
  body: unknown
): Promise<T> {
  const token = await getAccessToken(mailbox)
  const res = await fetch(`${GMAIL_BASE}/users/${encodeURIComponent(mailbox)}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    // 403 here is nearly always the missing scope rather than a real denial,
    // and the two read identically in Google's response.
    if (res.status === 403 || err.includes('insufficient') || err.includes('Insufficient')) {
      throw new GmailScopeError(mailbox)
    }
    throw new Error(`Gmail ${path} on ${mailbox} failed: ${res.status} — ${explainTokenError(err)}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

interface GmailLabel {
  id: string
  name: string
}

/**
 * Label ids, cached per mailbox for the life of the process.
 *
 * Gmail label ids are stable, and the sync resolves the same handful of names
 * on every lead — without this, a run over 200 leads would list the mailbox's
 * labels 200 times.
 */
const labelCache = new Map<string, Map<string, string>>()

async function loadLabels(mailbox: string): Promise<Map<string, string>> {
  const cached = labelCache.get(mailbox)
  if (cached) return cached

  const token = await getAccessToken(mailbox)
  const res = await fetch(`${GMAIL_BASE}/users/${encodeURIComponent(mailbox)}/labels`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.text()
    if (res.status === 403) throw new GmailScopeError(mailbox)
    throw new Error(`Gmail labels on ${mailbox} failed: ${res.status} — ${explainTokenError(err)}`)
  }

  const data = (await res.json()) as { labels?: GmailLabel[] }
  const map = new Map<string, string>()
  for (const l of data.labels ?? []) map.set(l.name, l.id)
  labelCache.set(mailbox, map)
  return map
}

/**
 * Resolve a label name to its id, creating the label if the mailbox has none.
 *
 * Nested names ("Ber AI/Pursue") are how Gmail models a label folder — Google
 * creates the parent implicitly, so there is nothing to do about hierarchy here.
 */
export async function ensureLabel(mailbox: string, name: string): Promise<string> {
  const labels = await loadLabels(mailbox)
  const existing = labels.get(name)
  if (existing) return existing

  const created = await gmailWrite<GmailLabel>(mailbox, '/labels', {
    name,
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  })
  labels.set(created.name, created.id)
  return created.id
}

/**
 * Add and/or remove labels on a whole thread.
 *
 * Thread-level rather than message-level: a bid invitation and its replies are
 * one conversation to the reader, and labelling only the first message means the
 * verdict disappears the moment somebody answers.
 */
export async function modifyThreadLabels(
  mailbox: string,
  threadId: string,
  opts: { add?: string[]; remove?: string[] }
): Promise<void> {
  const addLabelIds = await Promise.all((opts.add ?? []).map((n) => ensureLabel(mailbox, n)))

  // Removing resolves names WITHOUT creating: a label that no longer exists is
  // already absent from the thread, and creating it just to remove it would
  // litter the mailbox with empty labels.
  const known = await loadLabels(mailbox)
  const removeLabelIds = (opts.remove ?? [])
    .map((n) => known.get(n))
    .filter((id): id is string => Boolean(id))

  if (addLabelIds.length === 0 && removeLabelIds.length === 0) return

  await gmailWrite(mailbox, `/threads/${encodeURIComponent(threadId)}/modify`, {
    addLabelIds,
    removeLabelIds,
  })
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export interface DraftInput {
  mailbox: string
  /** The thread to reply into, so the draft appears in the conversation. */
  threadId: string
  to: string
  subject: string
  html: string
  /** Message-ID of the message being answered — makes it a real reply. */
  inReplyTo?: string | null
}

/**
 * Create a draft reply inside an existing thread. Returns the draft id.
 *
 * `message.threadId` is what makes Gmail file it in the conversation rather than
 * as a loose new message; In-Reply-To/References are what make other mail
 * clients agree. Both are needed — Gmail's own threading is not the standard.
 */
export async function createDraft(input: DraftInput): Promise<string> {
  const subject = /^re:/i.test(input.subject) ? input.subject : `Re: ${input.subject}`

  const raw = buildRawMessage({
    from: input.mailbox,
    to: input.to,
    subject,
    html: input.html,
    extraHeaders: input.inReplyTo
      ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`]
      : [],
  })

  const created = await gmailWrite<{ id: string }>(input.mailbox, '/drafts', {
    message: { threadId: input.threadId, raw },
  })
  return created.id
}
