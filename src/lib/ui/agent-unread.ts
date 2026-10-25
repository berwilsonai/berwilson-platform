/**
 * "You have an answer waiting" — the unread count behind the Ask Ber AI button.
 *
 * ⚠ A BADGE, NOT A NOTIFICATION INBOX. An in-app inbox was built here and
 * deleted on 2026-09-24: across the eight days it ran it wrote 52 rows and
 * **zero** were ever read or dismissed. The lesson is not "no in-app signal" —
 * it is that a second place to go is a place nobody goes. This puts one dot on a
 * button already in the header, pointing at the conversation, which is where the
 * durable copy of the answer has always been.
 *
 * ⚠ AND THE COUNT IS DERIVED FROM THE DATABASE, NEVER FROM `localStorage`.
 * §12: a cache in browser storage for content that lives in the database is not
 * a cache, it is the only copy the page can see — and the whole point of this
 * feature is that the answer arrived somewhere the browser was not. A reload, a
 * second tab or a different machine must all see the same number, which only
 * `agent_messages.seen_at` can give.
 *
 * ⚠ TYPED EVENT, for the reason `docks.ts` spells out: an untyped string event
 * is a contract nothing checks, and a rename silently stops the badge updating
 * while `tsc` stays green.
 */

export const AGENT_UNREAD_EVENT = 'ber-ai-unread-changed'

export interface UnreadAnswers {
  unread: number
  newest: { messageId: string; conversationId: string; preview: string } | null
}

export const NO_UNREAD: UnreadAnswers = { unread: 0, newest: null }

/** Ask the server what is waiting. Never throws — a dead badge beats a dead page. */
export async function fetchUnreadAnswers(): Promise<UnreadAnswers> {
  try {
    const res = await fetch('/api/ai/agent/answers', { cache: 'no-store' })
    if (!res.ok) return NO_UNREAD
    const data = await res.json()
    return {
      unread: typeof data.unread === 'number' ? data.unread : 0,
      newest: data.newest ?? null,
    }
  } catch {
    return NO_UNREAD
  }
}

/** Tell every listening badge to refetch. */
export function announceUnreadChanged(): void {
  window.dispatchEvent(new Event(AGENT_UNREAD_EVENT))
}

/**
 * Report what happened to one answer.
 *
 * `seen: true` stamps it read and sends nothing. `seen: false` is the client
 * saying nobody was looking, which is what releases the email and the text —
 * the server cannot work this out alone, because the dock stays mounted while
 * CLOSED and so an open connection proves nothing.
 *
 * Fire-and-forget by design: a failed report must never break the answer that
 * is already on screen or already in the database.
 */
export async function reportAnswerSeen(messageId: string, seen: boolean): Promise<void> {
  try {
    await fetch('/api/ai/agent/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, seen }),
    })
    announceUnreadChanged()
  } catch {
    /* reported on a best-effort basis — see the header */
  }
}

/** Mark everything waiting as read. Called when the dock is opened. */
export async function markAllAnswersSeen(): Promise<void> {
  const { newest, unread } = await fetchUnreadAnswers()
  if (!unread || !newest) return
  try {
    await fetch('/api/ai/agent/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: newest.messageId, seen: true, all: true }),
    })
  } catch { /* best effort */ }
  announceUnreadChanged()
}
