/**
 * Server-side loader for a record's FILED correspondence, shaped for the
 * RecordCorrespondence panel. Shared by the project Updates tab and the
 * opportunity detail page so the two surfaces cannot drift in what "filed"
 * means. Only what is already linked — the sweep for unfiled mail costs an
 * embedding call and is left to an explicit click in the panel.
 */
import { sweepDb } from './db'
import type { CorrespondenceThread } from '@/components/correspondence/RecordCorrespondence'

export async function loadFiledThreads(
  recordKind: 'project' | 'opportunity' | 'steel_deal' | 'lead',
  recordId: string
): Promise<CorrespondenceThread[]> {
  const { data: links } = await sweepDb()
    .from('thread_links')
    .select('thread_id, certainty, reason')
    .eq('record_kind', recordKind)
    .eq('record_id', recordId)

  const rows = (links ?? []) as unknown as Array<{
    thread_id: string
    certainty: string
    reason: string | null
  }>
  if (rows.length === 0) return []

  const { data: threads } = await sweepDb()
    .from('email_threads')
    .select('id, subject, mailbox, gmail_thread_id, last_at, message_count, attachment_count, summary')
    .in('id', rows.map((r) => r.thread_id))
    .order('last_at', { ascending: false })

  const meta = new Map(rows.map((r) => [r.thread_id, r]))
  return ((threads ?? []) as unknown as Array<{
    id: string
    subject: string | null
    mailbox: string | null
    gmail_thread_id: string | null
    last_at: string | null
    message_count: number | null
    attachment_count: number | null
    summary: { summary?: string } | null
  }>).map((t) => ({
    id: t.id,
    subject: t.subject,
    mailbox: t.mailbox,
    gmail_thread_id: t.gmail_thread_id,
    last_at: t.last_at,
    message_count: t.message_count,
    attachment_count: t.attachment_count,
    summary: t.summary?.summary ?? null,
    certainty: meta.get(t.id)?.certainty,
    why_filed: meta.get(t.id)?.reason ?? null,
  }))
}

/**
 * A compact recency block for splicing into record-query tool results.
 *
 * The agent's tool CHOICE is nondeterministic — asked "where does X stand" it
 * reaches for the structured record tool as often as the brief — so the one
 * fact that corrects a stale-status answer (when the deal was actually last
 * touched, per FILED mail) has to travel inside whichever tool it picks.
 */
export async function correspondenceRecency(
  recordKind: 'project' | 'opportunity' | 'steel_deal' | 'lead',
  recordId: string
): Promise<{
  filed_threads: number
  last_contact: string | null
  latest_subject: string | null
  note: string
}> {
  try {
    const { data: links } = await sweepDb()
      .from('thread_links')
      .select('thread_id')
      .eq('record_kind', recordKind)
      .eq('record_id', recordId)
    const ids = ((links ?? []) as Array<{ thread_id: string }>).map((l) => l.thread_id)
    if (ids.length === 0) {
      return {
        filed_threads: 0,
        last_contact: null,
        latest_subject: null,
        note: 'No correspondence is filed on this record. Do not infer silence — most mail is unfiled; run search_correspondence before any claim about momentum.',
      }
    }
    const { data: newest } = await sweepDb()
      .from('email_threads')
      .select('subject, last_at')
      .in('id', ids)
      .order('last_at', { ascending: false })
      .limit(1)
    const top = (newest?.[0] ?? null) as { subject: string | null; last_at: string | null } | null
    return {
      filed_threads: ids.length,
      last_contact: top?.last_at ?? null,
      latest_subject: top?.subject ?? null,
      note: 'AUTHORITATIVE recency: the newest email FILED on this record. Never describe this record as stalled, quiet, or unanswered as of any date earlier than last_contact — use get_record_correspondence to read the threads.',
    }
  } catch {
    return {
      filed_threads: 0,
      last_contact: null,
      latest_subject: null,
      note: 'Correspondence lookup unavailable.',
    }
  }
}
