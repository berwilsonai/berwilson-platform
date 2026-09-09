/**
 * Tie a confirmed intake session's conversation to the record it became.
 *
 * Lives here rather than inside the confirm route because a route file cannot
 * export helpers, and this one needed to be exercised directly: it runs only
 * when a human confirms a session, so on the route it would have executed for
 * the first time in production.
 */

import { sweepDb } from './db'
import { upsertLink } from './route-phase'

/**
 * Tie every thread in the confirmed cluster to the record it became.
 *
 * 'linked' certainty: these threads ARE that record's origin, so their later
 * mail posts without review. Seeded at each thread's current message count,
 * because confirmation has just carried this correspondence onto the record —
 * only what arrives afterwards is new.
 *
 * Entirely non-fatal. The records exist and the user's confirmation succeeded;
 * a missing link is repaired by the next routing pass, which reconciles derived
 * links on every run.
 */
export async function linkClusterToRecord(
  sessionId: string,
  projectId: string | null,
  opportunityId: string | null
): Promise<void> {
  if (!projectId && !opportunityId) return

  try {
    const db = sweepDb()
    const { data: clusters } = await db
      .from('thread_clusters')
      .select('id')
      .eq('session_id', sessionId)

    for (const raw of clusters ?? []) {
      const clusterId = (raw as { id: string }).id
      await db
        .from('thread_clusters')
        .update({
          state: 'confirmed',
          project_id: projectId,
          opportunity_id: opportunityId,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', clusterId)

      const { data: threads } = await db
        .from('email_threads')
        .select('id, message_count')
        .eq('cluster_id', clusterId)

      for (const t of threads ?? []) {
        const thread = t as { id: string; message_count: number | null }
        const seed = thread.message_count ?? 0
        if (projectId) {
          await upsertLink(
            thread.id,
            'project',
            projectId,
            'linked',
            1,
            'confirmed from this conversation',
            seed
          )
        }
        if (opportunityId) {
          await upsertLink(
            thread.id,
            'opportunity',
            opportunityId,
            'linked',
            1,
            'confirmed from this conversation',
            seed
          )
        }
      }
    }
  } catch (err) {
    console.error('[email-ingestion/confirm] could not link cluster to record:', err)
  }
}
