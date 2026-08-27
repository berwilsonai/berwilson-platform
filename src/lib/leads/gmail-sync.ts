/**
 * Write the triage verdict back onto the Gmail thread as a label.
 *
 * The lead queue only helps somebody who opens it, and most of the team cannot
 * reach the tailnet to open anything. A label costs one API call and makes the
 * verdict readable in the mailbox itself: an estimator scanning info@ sees which
 * invitations Ber AI rates worth bidding, without a login, a VPN, or an app.
 *
 * It also makes the marketing filter honest. Nineteen of the first twenty-six
 * threads were rejected as marketing; a rejection you can only inspect inside
 * the platform is a rejection nobody checks. Labelled in place, it is one click
 * to audit and one Gmail filter to correct.
 *
 * Exactly one "Ber AI/…" label per thread at a time. The previously applied one
 * is recorded on the lead and removed when the verdict moves, so a lead that was
 * `Consider` and is now `Promoted` reads as promoted rather than as both.
 */

import { LEAD_MAILBOXES } from '@/lib/integrations/google-workspace'
import { GmailScopeError, modifyThreadLabels } from '@/lib/integrations/gmail-write'
import { leadsDb, type LeadRow } from './db'

export interface LeadLabelProgress {
  considered: number
  labeled: number
  failed: number
  skipped: boolean
  reason?: string
  errors: string[]
}

/** Namespace, so every label the platform writes is one collapsible group. */
export const LABEL_PREFIX = 'Ber AI'

export const LEAD_LABELS = {
  pursue: `${LABEL_PREFIX}/Pursue`,
  consider: `${LABEL_PREFIX}/Consider`,
  pass: `${LABEL_PREFIX}/Pass`,
  filtered: `${LABEL_PREFIX}/Filtered`,
  promoted: `${LABEL_PREFIX}/Promoted`,
  forwarded: `${LABEL_PREFIX}/Forwarded — Dino`,
  closed: `${LABEL_PREFIX}/Closed`,
} as const

/**
 * The label a lead should carry right now, or null for "nothing to say yet".
 *
 * A decision outranks a verdict: once a human has promoted, forwarded, or shut
 * a lead down, that is the useful fact about the thread, and leaving it reading
 * `Pursue` invites somebody to act on it a second time.
 */
export function desiredLabel(lead: Pick<LeadRow, 'status' | 'fit_recommendation'>): string | null {
  switch (lead.status) {
    case 'promoted':
      return LEAD_LABELS.promoted
    case 'forwarded':
      return LEAD_LABELS.forwarded
    case 'ignored':
    case 'expired':
      return LEAD_LABELS.closed
    case 'spam':
      return LEAD_LABELS.filtered
    default:
      break
  }

  // Still open: the verdict is the fact worth publishing — but only once there
  // IS one. Labelling an unscored lead would say "Ber AI looked at this" before
  // it had.
  switch (lead.fit_recommendation) {
    case 'pursue':
      return LEAD_LABELS.pursue
    case 'consider':
      return LEAD_LABELS.consider
    case 'pass':
      return LEAD_LABELS.pass
    default:
      return null
  }
}

/** The fields a label decision actually depends on. */
export type LabelableLead = Pick<
  LeadRow,
  'id' | 'thread_id' | 'mailbox' | 'status' | 'fit_recommendation' | 'gmail_label'
>

/**
 * Bring one lead's thread label in line with its state, and record what was
 * written. Returns the label applied, or null when there was nothing to do.
 *
 * Separate from the sweep so a human decision shows up in the mailbox within
 * seconds of being made rather than at tomorrow's cron — the whole point is that
 * Gmail is where the people who cannot reach the platform are looking.
 */
export async function applyLeadLabel(lead: LabelableLead): Promise<string | null> {
  const want = desiredLabel(lead)
  if (!want || want === lead.gmail_label || !lead.thread_id) return null

  await modifyThreadLabels(lead.mailbox ?? LEAD_MAILBOXES[0], lead.thread_id, {
    add: [want],
    // Only the label THIS platform last applied is removed. Anything a human
    // filed the thread under is theirs and stays.
    remove: lead.gmail_label ? [lead.gmail_label] : [],
  })

  await leadsDb()
    .from('leads')
    .update({ gmail_label: want, gmail_labeled_at: new Date().toISOString() })
    .eq('id', lead.id)

  return want
}

/**
 * Fire-and-forget label refresh for a lead a human just acted on.
 * Swallows everything — a label is never worth failing a promotion over.
 */
export function refreshLeadLabel(lead: LabelableLead): void {
  void applyLeadLabel(lead).catch((err) => {
    console.warn('[leads/gmail-sync] label refresh failed:', err instanceof Error ? err.message : err)
  })
}

/** Cap per run, so a first pass over a large backlog cannot exhaust Gmail quota. */
const MAX_PER_RUN = 250

/**
 * Bring every lead's Gmail label in line with its current state.
 * Never throws — a mailbox that refuses a label must not stall the sweep.
 */
export async function syncLeadLabels(): Promise<LeadLabelProgress> {
  const progress: LeadLabelProgress = {
    considered: 0,
    labeled: 0,
    failed: 0,
    skipped: false,
    errors: [],
  }

  if (process.env.LEAD_GMAIL_LABELS === 'off') {
    return { ...progress, skipped: true, reason: 'LEAD_GMAIL_LABELS=off' }
  }

  try {
    const { data, error } = await leadsDb()
      .from('leads')
      .select('id, thread_id, mailbox, status, fit_recommendation, gmail_label')
      .not('thread_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(2000)
    if (error) return { ...progress, skipped: true, reason: error.message }

    for (const lead of (data ?? []) as LabelableLead[]) {
      // Nothing to say, or already says it. The overwhelming majority of leads
      // land here on any run after the first.
      const want = desiredLabel(lead)
      if (!want || want === lead.gmail_label) continue
      if (progress.labeled + progress.failed >= MAX_PER_RUN) {
        progress.reason = `Stopped at the ${MAX_PER_RUN}-thread cap; the rest label on the next run.`
        break
      }
      progress.considered++

      try {
        if (await applyLeadLabel(lead)) progress.labeled++
      } catch (err) {
        // A missing scope is not a per-lead failure — it will fail identically
        // for every remaining lead, so stop and say so once.
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
