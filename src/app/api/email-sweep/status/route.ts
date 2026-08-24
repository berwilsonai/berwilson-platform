import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { sweepDb, type MailboxSyncRow } from '@/lib/email-sweep/db'
import { MAILBOXES } from '@/lib/integrations/google-workspace'

/**
 * GET /api/email-sweep/status
 *
 * Where the sweep stands: per-mailbox fetch cursors, the summarizing backlog,
 * and how many candidate deals are waiting to be staged or reviewed.
 *
 * The backlog counts are what make a multi-day backfill legible — "3,412 of
 * 9,180 threads read" is the difference between progress and a hung job.
 */
export const maxDuration = 30

async function countThreads(state: string): Promise<number> {
  const db = sweepDb()
  const { count } = await db
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .eq('summary_state', state)
  return count ?? 0
}

export async function GET() {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson('Admins only')

  const db = sweepDb()

  try {
    const { data: syncData } = await db.from('mailbox_sync').select('*')
    const sync = (syncData ?? []) as MailboxSyncRow[]

    const [pending, summarized, failed, skipped] = await Promise.all([
      countThreads('pending'),
      countThreads('summarized'),
      countThreads('failed'),
      countThreads('skipped'),
    ])

    const { count: openClusters } = await db
      .from('thread_clusters')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'open')
      .is('session_id', null)

    const { count: stagedClusters } = await db
      .from('thread_clusters')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'staged')

    const { count: pendingReview } = await db
      .from('email_intake_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')

    return Response.json({
      mailboxes: MAILBOXES.map((mailbox) => {
        const row = sync.find((s) => s.mailbox === mailbox)
        return {
          mailbox,
          state: row?.state ?? 'idle',
          threadsSeen: row?.threads_seen ?? 0,
          threadsNew: row?.threads_new ?? 0,
          duplicatesSkipped: row?.duplicates_skipped ?? 0,
          sinceDays: row?.since_days ?? null,
          lastError: row?.last_error ?? null,
          startedAt: row?.started_at ?? null,
          completedAt: row?.completed_at ?? null,
          updatedAt: row?.updated_at ?? null,
        }
      }),
      threads: {
        pending,
        summarized,
        failed,
        skipped,
        total: pending + summarized + failed + skipped,
      },
      clusters: {
        awaitingStaging: openClusters ?? 0,
        staged: stagedClusters ?? 0,
      },
      review: { pending: pendingReview ?? 0 },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The sweep tables land in migration 20260823000001 — until it's applied,
    // say so plainly instead of surfacing a raw PostgREST error.
    if (/relation .* does not exist|schema cache/i.test(message)) {
      return Response.json(
        { error: 'The sweep tables are missing — apply migration 20260823000001.' },
        { status: 503 }
      )
    }
    return Response.json({ error: message }, { status: 500 })
  }
}
