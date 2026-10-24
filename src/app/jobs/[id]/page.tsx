import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Chip } from '@/components/ui/chip'
import JobLive from '@/components/jobs/JobLive'
import OperationReview, { type ReviewRow } from '@/components/jobs/OperationReview'
import { describeOperation, validateOperations } from '@/lib/jobs/operations'
import { JOB_STATUS, isStalled, jobStatusSpec } from '@/lib/jobs/status'
import { jobStaleMs } from '@/lib/jobs/run'
import { formatDate } from '@/lib/utils/constants'

export const metadata = { title: 'Job — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

interface OutcomeRow {
  index: number
  description: string
  status: string
  detail: string | null
}

const OUTCOME_TONE: Record<string, string> = {
  applied: 'positive',
  proposed: 'caution',
  skipped: 'neutral',
  failed: 'critical',
}

export default async function JobPage({ params }: PageProps) {
  const { id } = await params
  const db = createAdminClient()

  const { data: job, error } = await db
    .from('jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return <p className="text-sm text-critical">Could not read this job — {error.message}</p>
  }
  if (!job) notFound()

  const { data: events } = await db
    .from('job_events')
    .select('seq, kind, label, created_at')
    .eq('job_id', id)
    .order('seq')
    .limit(400)

  const spec = jobStatusSpec(job.status)
  const staleMs = jobStaleMs()
  const stalled = isStalled(job.status, job.heartbeat_at, staleMs)
  const live = JOB_STATUS[job.status as keyof typeof JOB_STATUS]?.live && !stalled

  // ⚠ Re-validated for display, not trusted from the column — the same reason
  // the apply route re-validates: the jsonb may have been written by an older
  // vocabulary, and a row that cannot run must not be shown as if it will.
  const { operations, rejected } = validateOperations(job.operations)
  const rows: ReviewRow[] = operations.map((op, i) => ({
    index: i,
    kind: op.kind,
    description: describeOperation(op),
    evidence: op.kind === 'update_field' ? op.evidence ?? null : null,
  }))

  const applied = (job.applied_result ?? null) as
    | { outcomes?: OutcomeRow[]; applied?: number; skipped?: number; failed?: number; proposed?: number }
    | null

  return (
    <div className="max-w-3xl space-y-6">
      {live && <JobLive />}

      <div className="space-y-2">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
        >
          <ArrowLeft size={12} /> All jobs
        </Link>
        <div className="flex items-start gap-3">
          <h1 className="min-w-0 flex-1 text-xl font-semibold text-foreground">
            {job.title || 'Untitled job'}
          </h1>
          <Chip tone={stalled ? 'critical' : spec.tone} className="shrink-0">
            {stalled ? 'Interrupted' : spec.label}
          </Chip>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatDate(job.queued_at)}
          {job.rounds > 0 && ` · ${job.rounds} round${job.rounds === 1 ? '' : 's'}`}
          {typeof job.latency_ms === 'number' && ` · ${Math.round(job.latency_ms / 1000)}s`}
          {!stalled && spec.hint && ` · ${spec.hint}`}
        </p>
        {/* ⚠ Named in words rather than left as a stuck spinner: a job killed by
            a deploy is reclaimed by the runner, and saying so is the difference
            between a wait and an outage. */}
        {stalled && (
          <p className="text-sm text-caution">
            This job stopped reporting — most likely the app restarted while it was working.
            The runner picks it up again on its next pass; what it had already done is kept.
          </p>
        )}
      </div>

      <section className="space-y-1.5">
        <p className="label-caps text-muted-foreground">The job</p>
        <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
          {job.instruction}
        </p>
      </section>

      {job.error && (
        <section className="space-y-1.5">
          <p className="label-caps text-muted-foreground">Error</p>
          <p className="rounded-lg border border-critical-edge bg-critical-surface p-3 text-sm text-critical">
            {job.error}
          </p>
        </section>
      )}

      {job.report && (
        <section className="space-y-1.5">
          <p className="label-caps text-muted-foreground">Report</p>
          <div className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-foreground">
            {job.report}
          </div>
        </section>
      )}

      {/* The review screen, only while there is something to decide. */}
      {job.status === 'review' && rows.length > 0 && (
        <section className="space-y-1.5">
          <p className="label-caps text-muted-foreground">Proposed changes</p>
          <OperationReview jobId={id} rows={rows} />
        </section>
      )}

      {rejected.length > 0 && (
        <section className="space-y-1.5">
          <p className="label-caps text-muted-foreground">
            {rejected.length} proposal{rejected.length === 1 ? '' : 's'} refused
          </p>
          <ul className="space-y-1 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
            {rejected.map((r, i) => <li key={i}>{r.reason}</li>)}
          </ul>
        </section>
      )}

      {applied?.outcomes && applied.outcomes.length > 0 && (
        <section className="space-y-1.5">
          <p className="label-caps text-muted-foreground">
            What was done — {applied.applied ?? 0} applied
            {applied.skipped ? `, ${applied.skipped} skipped` : ''}
            {applied.proposed ? `, ${applied.proposed} held for you` : ''}
            {applied.failed ? `, ${applied.failed} failed` : ''}
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {applied.outcomes.map((o) => (
              <li key={o.index} className="flex items-start gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm text-foreground">{o.description}</span>
                  {o.detail && <span className="block text-xs text-muted-foreground">{o.detail}</span>}
                </span>
                <Chip tone={OUTCOME_TONE[o.status] ?? 'neutral'} className="shrink-0">
                  {o.status}
                </Chip>
              </li>
            ))}
          </ul>
        </section>
      )}

      {events && events.length > 0 && (
        <section className="space-y-1.5">
          <p className="label-caps text-muted-foreground">What it did ({events.length} steps)</p>
          <ol className="divide-y divide-border rounded-lg border border-border bg-card text-xs">
            {events.map((e) => (
              <li key={e.seq} className="flex items-baseline gap-2 px-3 py-1.5">
                <span className="font-mono text-muted-foreground">{e.kind}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{e.label}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
