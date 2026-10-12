/**
 * A text conversation, rendered as the thread shape the mail pipeline already
 * consumes.
 *
 * ⚠ THIS IS THE WHOLE INGESTION, AND IT IS A TRANSLATION RATHER THAN A
 * PIPELINE. Nothing below fetch-phase.ts is Gmail-specific: `email_threads` is
 * the front door, and summarize → cluster → stage → route → apply → embed →
 * commitments → predecide all read that table. So a text session written as an
 * `email_threads` row gets a summary, a deal cluster, a routing decision, an
 * `updates` row on the record, retrieval chunks, commitment extraction and a
 * line in Pepper's morning note — with no change to any of those eight phases.
 *
 * ⚠ A CHAT IS NOT A THREAD. A mail thread is a bounded conversation that ends;
 * a chat is an unbounded stream — Eric's is 5,492 messages over 180 days and
 * will never end. Modelling one chat as one row would be a thread that grows
 * forever, re-summarized on every sweep, with `deltaFor` posting a
 * monotonically growing update onto the record. So the unit is a SESSION: a
 * burst of messages separated from the next by {@link SESSION_GAP_MS} of
 * silence, which is bounded, finite, and reads exactly like a thread.
 *
 * ⚠ THE CLASSIFIER STILL JUDGES THE WHOLE CHAT, NOT THE SESSION. That is
 * classify.ts's privacy decision and it survives here: per-session scoring
 * would leak the odd private evening out of an otherwise-personal thread every
 * time a word matched. A chat is business or it is not; only then is it split.
 */

import { createHash } from 'node:crypto'
import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import type { EmailAddress, MailMessage } from '@/lib/integrations/google-workspace'
import type { ResolvedThread } from '@/lib/integrations/gmail-search'
import { normalizePhone, type ChatVerdict } from './classify'
import type { ChatMessage, ChatRow } from './read'

/**
 * ⚠ THE DISCRIMINATOR IS `gmail_thread_id`, WHICH IS STRUCTURAL, NOT `mailbox`.
 *
 * `mailbox` is set to the owner's real mailbox on purpose — these texts WERE
 * found in Richard's Messages, so that column is true, and Pepper's
 * attribution, the commitments list filter and the chase pass all key on it
 * finding a real team member. What marks a row as not-mail is the one column
 * that can never be a Gmail id. §12: key a guard on the structural thing, not
 * on a display string — including one of ours.
 */
export const IMESSAGE_THREAD_PREFIX = 'imessage:'

/** True for a thread that exists only on this box and has no Gmail behind it. */
export function isIMessageThread(gmailThreadId: string | null | undefined): boolean {
  return typeof gmailThreadId === 'string' && gmailThreadId.startsWith(IMESSAGE_THREAD_PREFIX)
}

/**
 * Silence that ends a conversation.
 *
 * ⚠ MEASURED, NOT CHOSEN (§12). Over 49,183 consecutive-message gaps in the
 * last 365 days the median gap is 2.2 minutes — texting is bursty — and the
 * candidates sit at 11,835 gaps over 30 minutes, 5,476 over six hours and
 * 3,084 over a day. Run against Eric's thread, the one that matters:
 *
 *   3h  → 285 sessions, 19.3 messages each, 172 longest
 *   6h  → 183 sessions, 30.0 messages each, 219 longest
 *   12h →  79 sessions, 69.5 messages each, 409 longest
 *
 * Six hours gives one session per day over 180 days, which is what a day's
 * texting about a deal actually is. Twelve hours is the one that breaks
 * something: 409 messages renders past the local model's 40,000-character
 * input cap and would be silently truncated.
 */
export const SESSION_GAP_MS = 6 * 60 * 60 * 1000

/**
 * Split a chat into sessions, oldest first, each session oldest first.
 *
 * ⚠ ONLY CLOSED SESSIONS ARE RETURNED, AND THAT IS WHAT MAKES THIS CHEAP. A
 * session whose last message is less than SESSION_GAP_MS old is still being
 * written, so emitting it would have the sweep re-summarize the same
 * conversation every hour at 30-60s of local model each — and LM Studio serves
 * one request at a time, so that queue is paid by whoever is waiting on Ber AI.
 * Waiting for the gap costs up to six hours of latency on a text and buys a
 * row that is summarized exactly once and never grows.
 */
export function splitSessions(chat: ChatRow, now = Date.now()): ChatMessage[][] {
  // read.ts returns newest-first; sessions are easier to reason about forwards.
  const ordered = [...chat.messages].sort((a, b) => a.at.getTime() - b.at.getTime())
  if (ordered.length === 0) return []

  const sessions: ChatMessage[][] = []
  let current: ChatMessage[] = [ordered[0]]
  for (let i = 1; i < ordered.length; i += 1) {
    const gap = ordered[i].at.getTime() - ordered[i - 1].at.getTime()
    if (gap > SESSION_GAP_MS) {
      sessions.push(current)
      current = []
    }
    current.push(ordered[i])
  }
  sessions.push(current)

  return sessions.filter((s) => {
    const last = s[s.length - 1]?.at.getTime() ?? 0
    return now - last > SESSION_GAP_MS
  })
}

/** Who a handle is, where the directory knows. */
export interface Directory {
  /** Normalized 10-digit phone → party display name. */
  nameByPhone: Map<string, string>
  /** Normalized 10-digit phone → party email. */
  emailByPhone: Map<string, string>
  /** The owner's own name, for rendering their side of the conversation. */
  ownerName: string
}

/** A conversation's identity, stable across database rebuilds where possible. */
function chatKey(chat: ChatRow): string {
  return chat.guid ?? `rowid:${chat.chatId}`
}

/**
 * Who the other side is, in words.
 *
 * Prefers the directory's name for the number, then the chat's own display
 * name, then the last four digits. Never the raw number: a subject line is read
 * by a human and matched on by `bestMatch`, and a bare phone number helps
 * neither.
 */
function counterpartyLabel(chat: ChatRow, dir: Directory): string {
  const named = chat.handles
    .map((h) => {
      const n = normalizePhone(h)
      return n ? dir.nameByPhone.get(n) : undefined
    })
    .filter((v): v is string => Boolean(v))

  if (named.length === 1) return named[0]
  if (named.length > 1) return named.slice(0, 3).join(', ')
  if (chat.displayName?.trim()) return chat.displayName.trim()
  if (chat.handles.length > 1) return `group of ${chat.handles.length}`
  return `…${(chat.handles[0] ?? '?').slice(-4)}`
}

/** The address a handle is rendered and grouped under. */
function addressFor(handle: string, dir: Directory): EmailAddress {
  const n = normalizePhone(handle)
  const email = n ? dir.emailByPhone.get(n) : undefined
  const name = (n ? dir.nameByPhone.get(n) : undefined) ?? handle
  /**
   * ⚠ THE SYNTHETIC ADDRESS IS LOAD-BEARING FOR CLUSTERING, NOT COSMETIC.
   * `externalParticipants` splits a participant on `@` and drops anything with
   * no domain, so bare phone numbers carry no grouping signal at all and two
   * sessions with the same person on the same deal would never share a
   * participant. Giving a handle a domain makes `sharesExternal` work for texts
   * the way it already works for mail. Where the directory knows the person's
   * real email, that is used instead — which also reaches `bestMatch`'s shared-
   * contact bar, since a project's contacts are email addresses.
   */
  return { name, address: email ?? `${n ?? handle.replace(/[^\w.+-]/g, '')}@imessage.local` }
}

/**
 * One session as a thread.
 *
 * Builds real `MailMessage`s rather than hand-rolling markdown, so
 * `renderThread` produces the `### <ts> — <sender>` headings that `deltaFor`
 * counts. Writing the markdown directly here would work until someone changed
 * the renderer, and then updates would silently re-post the whole conversation.
 */
function sessionToThread(
  chat: ChatRow,
  session: ChatMessage[],
  dir: Directory
): ResolvedThread | null {
  if (session.length === 0) return null

  const key = chatKey(chat)
  const startedAt = session[0].at
  const threadId = `${IMESSAGE_THREAD_PREFIX}${key}:${startedAt.getTime()}`
  const fingerprint = `${IMESSAGE_THREAD_PREFIX}${createHash('sha256')
    .update(`${key}\n${startedAt.getTime()}`)
    .digest('hex')
    .slice(0, 32)}`

  const owner: EmailAddress = { name: dir.ownerName, address: PRIMARY_MAILBOX }
  const others = chat.handles.map((h) => addressFor(h, dir))

  const messages: MailMessage[] = session.map((m, i) => ({
    id: `${threadId}:${i}`,
    threadId,
    messageId: `${threadId}:${i}`,
    mailbox: PRIMARY_MAILBOX,
    subject: '',
    from: m.fromMe ? owner : (others[0] ?? { name: 'unknown', address: 'unknown@imessage.local' }),
    to: m.fromMe ? others : [owner],
    cc: [],
    receivedAt: m.at.toISOString(),
    bodyText: m.text,
    snippet: m.text.slice(0, 160),
    attachments: [],
    webLink: '',
  }))

  const label = counterpartyLabel(chat, dir)
  const day = startedAt.toISOString().slice(0, 10)

  return {
    fingerprint,
    mailbox: PRIMARY_MAILBOX,
    threadId,
    subject: `Texts with ${label} — ${day}`,
    messages,
    firstAt: startedAt.toISOString(),
    lastAt: session[session.length - 1].at.toISOString(),
    participants: [...new Set([PRIMARY_MAILBOX, ...others.map((a) => a.address)])],
    attachmentCount: 0,
  }
}

/**
 * Every closed session of a business conversation, as threads.
 *
 * Takes the verdict so the caller cannot forget it: a chat that did not clear
 * the bar produces nothing, and an excluded one is never even split.
 */
export function chatToThreads(
  chat: ChatRow,
  verdict: ChatVerdict,
  dir: Directory,
  now = Date.now()
): ResolvedThread[] {
  if (!verdict.business) return []
  return splitSessions(chat, now)
    .map((s) => sessionToThread(chat, s, dir))
    .filter((t): t is ResolvedThread => t !== null)
}
