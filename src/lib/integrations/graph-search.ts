/**
 * Microsoft Graph message search for the in-platform Email Research flow.
 * Kept separate from microsoft-graph.ts (OAuth/calendar/legacy) — this file
 * owns search + conversation assembly only.
 *
 * Graph quirks encoded here:
 * - $search cannot combine with $filter/$orderby/$skip; results are
 *   relevance-ranked (max 250/page), so date filtering happens client-side.
 * - The search term is KQL: wrap in double quotes, escape embedded quotes.
 * - $filter on conversationId must NOT add $orderby (Graph rejects it as an
 *   inefficient filter) — sort in JS instead.
 */

import { getValidAccessToken, type GraphMessage } from './microsoft-graph'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const TARGET_EMAIL = 'tuaone@berwilson.com'

export interface ConversationSummary {
  conversationId: string
  subject: string
  latestReceived: string // ISO
  messageCount: number
}

export interface SearchConversationsResult {
  conversations: ConversationSummary[]
  totalFound: number
  truncated: boolean
}

interface MessageStub {
  id: string
  conversationId: string
  subject: string
  receivedDateTime: string
  hasAttachments: boolean
}

async function graphGet<T>(path: string, email: string): Promise<T> {
  const token = await getValidAccessToken(email)
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph API ${path.split('?')[0]} failed: ${res.status} — ${err.slice(0, 500)}`)
  }
  return res.json()
}

/**
 * Search the mailbox for messages matching a term and group the hits into
 * conversations, newest first, capped at maxConversations.
 */
export async function searchConversations(
  term: string,
  opts: { sinceDays?: number; maxConversations?: number; email?: string } = {}
): Promise<SearchConversationsResult> {
  const email = opts.email ?? TARGET_EMAIL
  const maxConversations = Math.min(opts.maxConversations ?? 15, 25)

  // KQL term: escape embedded double quotes, wrap the whole thing in quotes
  const kql = `"${term.replace(/"/g, '\\"')}"`
  const params = new URLSearchParams({
    $search: kql,
    $top: '100',
    $select: 'id,conversationId,subject,receivedDateTime,hasAttachments',
  })

  const result = await graphGet<{ value: MessageStub[] }>(
    `/users/${email}/messages?${params}`,
    email
  )

  let hits = result.value ?? []

  // Client-side date filter ($search can't combine with $filter)
  if (opts.sinceDays && opts.sinceDays > 0) {
    const cutoff = Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000
    hits = hits.filter((m) => new Date(m.receivedDateTime).getTime() >= cutoff)
  }

  // Group by conversation
  const byConversation = new Map<string, ConversationSummary>()
  for (const m of hits) {
    if (!m.conversationId) continue
    const existing = byConversation.get(m.conversationId)
    if (!existing) {
      byConversation.set(m.conversationId, {
        conversationId: m.conversationId,
        subject: m.subject || '(no subject)',
        latestReceived: m.receivedDateTime,
        messageCount: 1,
      })
    } else {
      existing.messageCount++
      if (m.receivedDateTime > existing.latestReceived) {
        existing.latestReceived = m.receivedDateTime
        existing.subject = m.subject || existing.subject
      }
    }
  }

  const sorted = [...byConversation.values()].sort((a, b) =>
    b.latestReceived.localeCompare(a.latestReceived)
  )

  return {
    conversations: sorted.slice(0, maxConversations),
    totalFound: sorted.length,
    truncated: sorted.length > maxConversations,
  }
}

/**
 * Fetch the full messages of one conversation, oldest first.
 * No $orderby (Graph rejects it with a conversationId filter) — sorted in JS.
 */
export async function fetchConversationMessages(
  conversationId: string,
  opts: { email?: string; maxMessages?: number } = {}
): Promise<GraphMessage[]> {
  const email = opts.email ?? TARGET_EMAIL
  const maxMessages = opts.maxMessages ?? 30

  const params = new URLSearchParams({
    $filter: `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
    $top: '50',
    $select: 'id,internetMessageId,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,isRead,webLink',
  })

  const result = await graphGet<{ value: GraphMessage[] }>(
    `/users/${email}/messages?${params}`,
    email
  )

  const messages = (result.value ?? []).sort((a, b) =>
    a.receivedDateTime.localeCompare(b.receivedDateTime)
  )

  // Keep the most recent N while preserving chronological order
  return messages.length > maxMessages ? messages.slice(messages.length - maxMessages) : messages
}
