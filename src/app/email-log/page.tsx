import { Suspense } from 'react'
import { Mail, CheckCircle2, Clock, XCircle, MinusCircle, AlertTriangle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import BackfillButton from '@/components/email/BackfillButton'

export const metadata = { title: 'Email Log — Ber Wilson Intelligence' }

type ProcessedEmail = {
  id: string
  subject: string | null
  sender_email: string | null
  status: string | null
  processed_at: string | null
  update_id: string | null
  updates: { id: string; review_state: string } | null
}

type ReviewQueueEntry = {
  record_id: string
  id: string
  resolution: string | null
  resolved_at: string | null
}

type DisplayStatus = 'ingested' | 'in_review' | 'rejected' | 'skipped' | 'failed'

function computeDisplayStatus(
  email: ProcessedEmail,
  reviewMap: Record<string, ReviewQueueEntry>
): DisplayStatus {
  if (!email.status || email.status === 'failed') return 'failed'
  if (email.status === 'skipped' || !email.update_id || !email.updates) return 'skipped'

  const rq = reviewMap[email.update_id]
  if (!rq) return 'ingested' // no review queue entry = auto-approved
  if (!rq.resolved_at) return 'in_review'
  if (rq.resolution === 'rejected') return 'rejected'
  return 'ingested'
}

const STATUS_CONFIG: Record<
  DisplayStatus,
  { label: string; color: string; Icon: React.ComponentType<{ size?: number }> }
> = {
  ingested: {
    label: 'Ingested',
    color: 'text-emerald-700 bg-emerald-50 ring-emerald-200',
    Icon: CheckCircle2,
  },
  in_review: {
    label: 'In Review',
    color: 'text-amber-700 bg-amber-50 ring-amber-200',
    Icon: Clock,
  },
  rejected: {
    label: 'Rejected',
    color: 'text-rose-700 bg-rose-50 ring-rose-200',
    Icon: XCircle,
  },
  skipped: {
    label: 'Skipped',
    color: 'text-slate-500 bg-slate-50 ring-slate-200',
    Icon: MinusCircle,
  },
  failed: {
    label: 'Failed',
    color: 'text-red-700 bg-red-50 ring-red-200',
    Icon: AlertTriangle,
  },
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

export default async function EmailLogPage() {
  const supabase = createAdminClient()

  const { data: emails, error } = await supabase
    .from('processed_emails')
    .select('id, subject, sender_email, status, processed_at, update_id, updates(id, review_state)')
    .order('processed_at', { ascending: false })
    .limit(200)

  if (error) throw new Error(`Failed to load email log: ${error.message}`)

  const allEmails = (emails ?? []) as ProcessedEmail[]

  // Fetch review queue entries for all update IDs (no direct FK so we do a second query)
  const updateIds = allEmails.map((e) => e.update_id).filter(Boolean) as string[]
  const reviewMap: Record<string, ReviewQueueEntry> = {}

  if (updateIds.length > 0) {
    const { data: rqRows } = await supabase
      .from('review_queue')
      .select('record_id, id, resolution, resolved_at')
      .in('record_id', updateIds)
      .eq('source_table', 'updates')

    for (const row of rqRows ?? []) {
      reviewMap[row.record_id] = row as ReviewQueueEntry
    }
  }

  const emailsWithStatus = allEmails.map((e) => ({
    ...e,
    displayStatus: computeDisplayStatus(e, reviewMap),
    reviewQueueId: e.update_id ? (reviewMap[e.update_id]?.id ?? null) : null,
  }))

  const counts = emailsWithStatus.reduce(
    (acc, e) => {
      acc[e.displayStatus] = (acc[e.displayStatus] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Email Log</h1>
          <span className="text-xs text-muted-foreground">
            {allEmails.length} email{allEmails.length !== 1 ? 's' : ''}
          </span>
        </div>
        <Suspense>
          <BackfillButton />
        </Suspense>
      </div>

      {/* Summary pills */}
      {allEmails.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {(Object.entries(STATUS_CONFIG) as [DisplayStatus, (typeof STATUS_CONFIG)[DisplayStatus]][]).map(
            ([key, cfg]) => {
              const n = counts[key] ?? 0
              if (n === 0) return null
              const { Icon } = cfg
              return (
                <span
                  key={key}
                  className={`inline-flex items-center gap-1 text-xs font-medium ring-1 ring-inset px-2.5 py-1 rounded-full ${cfg.color}`}
                >
                  <Icon size={11} />
                  {n} {cfg.label}
                </span>
              )
            }
          )}
        </div>
      )}

      {/* Email table */}
      {allEmails.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Mail size={32} className="opacity-30" />
          <p className="text-sm">No emails have been processed yet.</p>
          <p className="text-xs">Use the Backfill button above to import historical emails, or send a test email.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Received
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  From
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Subject
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {emailsWithStatus.map((email) => {
                const cfg = STATUS_CONFIG[email.displayStatus]
                const { Icon } = cfg
                return (
                  <tr key={email.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {email.processed_at ? formatDate(email.processed_at) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[180px]">
                      {email.sender_email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm max-w-[320px]">
                      <span className="line-clamp-1">
                        {email.subject ?? (
                          <span className="text-muted-foreground italic">No subject</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium ring-1 ring-inset px-2 py-0.5 rounded ${cfg.color}`}
                      >
                        <Icon size={10} />
                        {cfg.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
