import { ListChecks } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { Chip } from '@/components/ui/chip'
import JobComposer from '@/components/jobs/JobComposer'
import JobLive from '@/components/jobs/JobLive'
import { JOB_STATUS, isStalled, jobStatusSpec } from '@/lib/jobs/status'
import { jobStaleMs } from '@/lib/jobs/run'
import { formatDate } from '@/lib/utils/constants'

export const metadata = { title: 'Jobs — Ber Wilson Intelligence' }

interface JobRow {
  id: string
  title: string | null
  status: string
  queued_at: string
  finished_at: string | null
  heartbeat_at: string | null
  rounds: number
  operations: unknown
  applied_at: string | null
}

function operationCount(v: unknown): number {
  return Array.isArray(v) ? v.length : 0
}

export default async function JobsPage() {
  const db = createAdminClient()
  const { data, error } = await db
    .from('jobs')
    .select('id, title, status, queued_at, finished_at, heartbeat_at, rounds, operations, applied_at')
    .order('queued_at', { ascending: false })
    .limit(50)

  const jobs = (data ?? []) as JobRow[]
  const staleMs = jobStaleMs()
  const anyLive = jobs.some(
    (j) => JOB_STATUS[j.status as keyof typeof JOB_STATUS]?.live && !isStalled(j.status, j.heartbeat_at, staleMs)
  )

  return (
    /*
      ⚠ TWO COLUMNS, NOT A 768px STRIP IN A 1,451px FRAME. The page was
      `max-w-3xl` left-aligned, so two-thirds of the screen was empty while
      the composer and the run list queued up vertically beneath each other.
      The composer is the page's job and keeps the reading width; the runs are
      a glanceable list and belong beside it, which is also where a reader
      looks to check whether the thing they just started is working.
    */
    <div className="space-y-6">
      {anyLive && <JobLive />}

      <PageHeader
        icon={ListChecks}
        title="Jobs"
        description="Hand over a piece of work. It reads the platform's own records and writes you a report; if the job calls for changes it proposes them and you decide."
        className="mb-0"
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
      <JobComposer />

      {/* ⚠ The error is stated rather than rendered as an empty list: a failed
          read and an empty table are the same value and opposite facts (§12). */}
      {error ? (
        <p className="text-sm text-critical">Could not read the job list — {error.message}</p>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No jobs yet.</p>
      ) : (
        <div className="space-y-1.5">
          <p className="label-caps text-muted-foreground">Recent</p>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {jobs.map((job) => {
              const spec = jobStatusSpec(job.status)
              const stalled = isStalled(job.status, job.heartbeat_at, staleMs)
              const ops = operationCount(job.operations)
              return (
                <li key={job.id}>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted transition-colors outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                  >
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block truncate text-sm text-foreground">
                        {job.title || 'Untitled job'}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(job.queued_at)}
                        {job.rounds > 0 && ` · ${job.rounds} round${job.rounds === 1 ? '' : 's'}`}
                        {ops > 0 && ` · ${ops} proposed`}
                        {job.applied_at && ' · applied'}
                      </span>
                    </span>
                    <Chip tone={stalled ? 'critical' : spec.tone} className="shrink-0">
                      {stalled ? 'Interrupted' : spec.label}
                    </Chip>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      </div>
    </div>
  )
}
