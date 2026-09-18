import { createAdminClient } from '@/lib/supabase/admin'
import UpdatesTab from '@/components/projects/UpdatesTab'
import RecordCorrespondence, {
  type CorrespondenceThread,
} from '@/components/correspondence/RecordCorrespondence'
import { sweepDb } from '@/lib/email-sweep/db'

export const metadata = { title: 'Updates — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function UpdatesPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [{ data: updates }, { data: project }, filed] = await Promise.all([
    supabase
      .from('updates')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('projects').select('name').eq('id', id).single(),
    // Only what is already filed — the sweep for unfiled mail costs an
    // embedding call and is left to an explicit click.
    loadFiledThreads(id),
  ])

  return (
    <div className="space-y-4">
      <RecordCorrespondence
        recordKind="project"
        recordId={id}
        recordName={project?.name ?? ''}
        initialFiled={filed}
      />
      <UpdatesTab projectId={id} initialUpdates={updates ?? []} />
    </div>
  )
}

async function loadFiledThreads(projectId: string): Promise<CorrespondenceThread[]> {
  const { data: links } = await sweepDb()
    .from('thread_links')
    .select('thread_id, certainty, reason')
    .eq('record_kind', 'project')
    .eq('record_id', projectId)

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
