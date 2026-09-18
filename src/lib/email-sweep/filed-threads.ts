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
    .select('id, subject, mailbox, last_at, message_count, attachment_count, summary')
    .in('id', rows.map((r) => r.thread_id))
    .order('last_at', { ascending: false })

  const meta = new Map(rows.map((r) => [r.thread_id, r]))
  return ((threads ?? []) as unknown as Array<{
    id: string
    subject: string | null
    mailbox: string | null
    last_at: string | null
    message_count: number | null
    attachment_count: number | null
    summary: { summary?: string } | null
  }>).map((t) => ({
    id: t.id,
    subject: t.subject,
    mailbox: t.mailbox,
    last_at: t.last_at,
    message_count: t.message_count,
    attachment_count: t.attachment_count,
    summary: t.summary?.summary ?? null,
    certainty: meta.get(t.id)?.certainty,
    why_filed: meta.get(t.id)?.reason ?? null,
  }))
}
