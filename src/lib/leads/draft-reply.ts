/**
 * Leave a reply in the mailbox for a human to send.
 *
 * A `pursue` bid invitation needs an answer within a day — asking for the plans,
 * confirming the bid date, pinning down whether the site visit is mandatory.
 * That reply was being written by hand, or late, or not at all, while the local
 * model sat idle 94% of the time. This moves the writing to the idle resource
 * and leaves the judgement with the person.
 *
 * The platform creates a DRAFT and stops. It never sends. That is the whole
 * safety model: the "mail never becomes an action without human review" rule is
 * satisfied structurally rather than by policy, because an unsent draft does
 * nothing on its own.
 *
 * One draft per lead, ever. `gmail_draft_id` is the latch — a lead whose draft
 * a human deleted is not re-drafted, because deleting it was the decision.
 */

import { callGemini } from '@/lib/ai/gemini'
import {
  LEAD_REPLY_PROMPT_VERSION,
  LEAD_REPLY_SYSTEM_PROMPT,
  buildLeadReplyMessage,
} from '@/lib/ai/prompts/lead-reply'
import { LEAD_MAILBOXES, allMailboxes, fetchThread } from '@/lib/integrations/google-workspace'
import { GmailScopeError, createDraft } from '@/lib/integrations/gmail-write'
import {
  GMAIL_THREAD_EMBED,
  leadsDb,
  resolveGmailThreadId,
  stringArray,
  type LeadRow,
} from './db'

export interface LeadDraftProgress {
  considered: number
  drafted: number
  /** Automated senders with no human to answer — expected, not a fault. */
  noReply: number
  failed: number
  skipped: boolean
  reason?: string
  outOfTime?: boolean
  errors: string[]
}

/**
 * Only `pursue`.
 *
 * A `consider` lead is one a human still has to think about, and a drafted reply
 * quietly pushes it toward being answered — the queue should not lobby. Drafting
 * only for the verdict that means "we should be bidding this" keeps the drafts
 * few enough to be trusted.
 */
const DRAFT_FOR = new Set(['pursue'])

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Addresses that cannot receive a reply.
 *
 * A large share of inbound bid invitations arrive from plan rooms (BidNet,
 * Dodge, iSqFt) as automated notifications from a no-reply address, where the
 * real response goes through the portal instead. Drafting into one of those is
 * worse than drafting nothing: it looks like a reply is ready to send, and it
 * would go nowhere. Better to leave the lead alone and let the queue's own
 * links take the reader to the portal.
 */
const NO_REPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|automated|mailer[-_.]?daemon|bounce)/i

/** True when nothing useful can be sent to this address. */
export function isNoReplyAddress(address: string | null | undefined): boolean {
  if (!address) return true
  const local = address.split('@')[0] ?? ''
  return NO_REPLY.test(local.trim())
}

/**
 * The best address to answer on a thread.
 *
 * Walks BACKWARDS from the most recent message, skipping two kinds of sender:
 * robots (nothing to answer) and OURSELVES. The last message in a live thread
 * is very often Ber Wilson's own reply, and answering that addresses the draft
 * back to the mailbox it was written in — which reads as a working draft right
 * up until somebody notices it goes nowhere.
 *
 * Returns null when no external human ever spoke.
 */
export function replyAddressFor(
  messages: { from?: { address?: string | null } | null }[],
  fallback: string | null,
  ownAddresses: Iterable<string> = []
): string | null {
  const ours = new Set([...ownAddresses].map((a) => a.trim().toLowerCase()))
  const usable = (addr: string | null | undefined): addr is string =>
    Boolean(addr) && !isNoReplyAddress(addr) && !ours.has(String(addr).trim().toLowerCase())

  for (let i = messages.length - 1; i >= 0; i--) {
    const addr = messages[i]?.from?.address
    if (usable(addr)) return addr
  }
  return usable(fallback) ? fallback : null
}

/** Strip the model's habitual code fence and any stray subject line. */
function cleanHtml(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^```(?:html)?\s*/i, '').replace(/```$/, '').trim()
  text = text.replace(/^subject:.*$/im, '').trim()
  // A bare-text answer is still usable — wrap it so the draft is valid HTML.
  if (!/<[a-z][\s\S]*>/i.test(text)) {
    return text
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('\n')
  }
  return text
}

/**
 * Draft acknowledgements for pursue-rated leads that do not have one.
 * Never throws.
 */
export async function draftLeadReplies(
  opts: { budgetMs?: number; userId?: string; limit?: number } = {}
): Promise<LeadDraftProgress> {
  const progress: LeadDraftProgress = {
    considered: 0,
    drafted: 0,
    noReply: 0,
    failed: 0,
    skipped: false,
    errors: [],
  }

  if (process.env.LEAD_DRAFT_REPLIES === 'off') {
    return { ...progress, skipped: true, reason: 'LEAD_DRAFT_REPLIES=off' }
  }

  const started = Date.now()
  const budgetMs = opts.budgetMs ?? 10 * 60 * 1000

  try {
    const { data, error } = await leadsDb()
      .from('leads')
      .select(`*, ${GMAIL_THREAD_EMBED}`)
      .in('status', ['new', 'reviewing'])
      .eq('score_state', 'scored')
      // The verdict filter belongs in the QUERY, not after it. Applied in JS
      // the limit bounds the wrong set: with more scored leads than the limit,
      // a pursue lead sitting below the cut is fetched away by leads that were
      // never candidates, and never gets drafted at all.
      .in('fit_recommendation', [...DRAFT_FOR])
      .is('gmail_draft_id', null)
      .not('thread_id', 'is', null)
      .order('bid_due_date', { ascending: true, nullsFirst: false })
      .limit(opts.limit ?? 20)
    if (error) return { ...progress, skipped: true, reason: error.message }

    const leads = (data ?? []) as LeadRow[]

    for (const lead of leads) {
      if (Date.now() - started > budgetMs) {
        progress.outOfTime = true
        break
      }
      progress.considered++
      const mailbox = lead.mailbox ?? LEAD_MAILBOXES[0]

      try {
        // Gmail's id for the conversation, not our UUID primary key — the two
        // are different values and Google rejects ours outright.
        const gmailThreadId = await resolveGmailThreadId(lead)
        if (!gmailThreadId) {
          progress.failed++
          progress.errors.push(`${lead.title}: no Gmail thread id on the stored thread.`)
          continue
        }

        // Re-read the thread rather than trusting the lead's stored sender: the
        // reply belongs to whoever spoke LAST, which after a follow-up is often
        // not the person who opened it.
        const messages = await fetchThread(mailbox, gmailThreadId)
        const last = messages[messages.length - 1]
        // Every mailbox this platform reads is "us" — a thread can legitimately
        // involve more than one of them, and none of them is a recipient.
        const to = replyAddressFor(messages, lead.sender_email, allMailboxes())
        if (!to) {
          // Not a failure — an automated plan-room notification is a normal
          // thing to receive, and it simply has nobody to answer.
          progress.noReply++
          continue
        }

        const { data: body } = await callGemini<string>({
          task: 'lead_reply_draft',
          systemPrompt: LEAD_REPLY_SYSTEM_PROMPT,
          promptVersion: LEAD_REPLY_PROMPT_VERSION,
          jsonMode: false,
          userId: opts.userId ?? SYSTEM_USER_ID,
          userMessage: buildLeadReplyMessage({
            title: lead.title,
            senderName: last?.from?.name || lead.sender_name,
            senderCompany: lead.sender_company,
            summary: lead.summary,
            scope: lead.scope,
            location: lead.location,
            solicitationNumber: lead.solicitation_number,
            bidDueDate: lead.bid_due_date,
            siteVisitDate: lead.site_visit_date,
            rfiDueDate: lead.rfi_due_date,
            questions: stringArray(lead.fit_questions),
            requirements: stringArray(lead.requirements),
          }),
        })

        const html = cleanHtml(typeof body === 'string' ? body : String(body ?? ''))
        if (html.length < 40) {
          progress.failed++
          progress.errors.push(`${lead.title}: the model returned nothing usable.`)
          continue
        }

        const draftId = await createDraft({
          mailbox,
          threadId: gmailThreadId,
          to,
          subject: last?.subject || lead.title,
          inReplyTo: last?.messageId ?? null,
          html,
        })

        await leadsDb()
          .from('leads')
          .update({ gmail_draft_id: draftId, draft_created_at: new Date().toISOString() })
          .eq('id', lead.id)
        progress.drafted++
      } catch (err) {
        if (err instanceof GmailScopeError) {
          return { ...progress, skipped: true, reason: err.message }
        }
        progress.failed++
        if (progress.errors.length < 5) {
          progress.errors.push(err instanceof Error ? err.message : String(err))
        }
      }
    }
  } catch (err) {
    progress.errors.push(err instanceof Error ? err.message : String(err))
  }

  return progress
}
