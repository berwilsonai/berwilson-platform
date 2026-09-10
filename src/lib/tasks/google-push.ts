/**
 * Push one task to Google immediately, without making the caller wait.
 *
 * The reconcile alone would be enough for correctness, but not for trust: a
 * task assigned at 9am that does not reach the assignee's phone until the next
 * cron tick teaches people the sync is unreliable, and a task list nobody
 * believes is worse than none. So the API routes fire one of these and move on,
 * exactly as refreshLeadLabel does for Gmail labels.
 *
 * WHY THE DEBOUNCE, WHICH refreshLeadLabel DID NOT NEED
 *
 * TaskDetailSheet autosaves every field individually — title on blur, assignee
 * on change, due date on change, what/why/how each on their own blur. Editing
 * three fields in a few seconds fires three PATCHes, which without coalescing
 * become three concurrent writes racing each other against the same remote
 * task. Four seconds of quiet collapses that into one.
 *
 * This is deliberately NOT wired into the three bulk creators (meeting intake
 * confirm, email ingestion confirm, action-items). Those insert five to twenty
 * tasks inside a human-facing click, and twenty Google round trips is the wrong
 * thing to put in front of someone pressing a button. The cron covers them,
 * which is the real reason its cadence is minutes rather than nightly.
 */

import { syncGoogleTasks } from '@/lib/tasks/google-sync'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteTask } from '@/lib/integrations/google-tasks-write'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'

const DEBOUNCE_MS = 4_000

/**
 * Module scope, which is safe here and would not be on a serverless host: the
 * platform runs as a long-lived `next start`, so the timer lives to fire.
 */
const pending = new Map<string, NodeJS.Timeout>()

function warn(scope: string, err: unknown) {
  console.warn(`[google-tasks] ${scope}:`, err instanceof Error ? err.message : err)
}

/**
 * Sync the one member who owns this task, now-ish.
 *
 * Runs the ordinary reconcile scoped to that member rather than a bespoke
 * single-task path, so there is exactly one implementation of the merge and the
 * fast path cannot drift from the slow one.
 */
export async function pushTaskNow(taskId: string): Promise<void> {
  if (!isGoogleConfigured()) return
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('tasks')
    .select('assignee_id')
    .eq('id', taskId)
    .maybeSingle()
  if (!data?.assignee_id) return

  await syncGoogleTasks({ onlyMemberId: data.assignee_id, budgetMs: 60_000 })
}

/**
 * Queue a push, collapsing a burst of field-by-field saves into one.
 *
 * The `.catch()` is mandatory rather than tidy: an unhandled rejection in a
 * detached promise can take the whole Node process down.
 */
export function queueTaskPush(taskId: string): void {
  if (!isGoogleConfigured()) return
  const existing = pending.get(taskId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    pending.delete(taskId)
    void pushTaskNow(taskId).catch((err) => warn(`push ${taskId}`, err))
  }, DEBOUNCE_MS)
  // Do not hold the process open for a debounce timer.
  timer.unref?.()
  pending.set(taskId, timer)
}

/** What a deleted task's link looked like, captured before the row went away. */
export interface RemovableLink {
  mailbox: string
  google_list_id: string
  google_task_id: string
}

/**
 * Read the link for a task that is ABOUT to be deleted.
 *
 * Must be called before the delete: task_google_links cascades on task_id, so
 * once the row is gone there is nothing left to say which Google task to clean
 * up — and the copy in the member's list would survive forever, pointing at a
 * task that no longer exists.
 */
export async function readRemovableLink(taskId: string): Promise<RemovableLink | null> {
  if (!isGoogleConfigured()) return null
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('task_google_links')
      .select('google_list_id, google_task_id, team_member_id')
      .eq('task_id', taskId)
      .eq('state', 'active')
      .maybeSingle()
    if (!data) return null

    const { data: list } = await supabase
      .from('google_task_lists')
      .select('mailbox')
      .eq('team_member_id', data.team_member_id)
      .maybeSingle()
    if (!list?.mailbox) return null

    return {
      mailbox: list.mailbox,
      google_list_id: data.google_list_id,
      google_task_id: data.google_task_id,
    }
  } catch (err) {
    warn(`read link ${taskId}`, err)
    return null
  }
}

/**
 * Remove a task from the member's list after it was deleted here.
 *
 * Deleting remotely is correct in this one direction only: we created it, and
 * the thing it referred to is gone. It is not the same act as a member deleting
 * a task themselves, which is a decision this platform records and obeys.
 */
export function queueTaskRemoval(link: RemovableLink | null): void {
  if (!link || !isGoogleConfigured()) return
  void deleteTask(link.mailbox, link.google_list_id, link.google_task_id).catch((err) =>
    warn(`remove ${link.google_task_id}`, err)
  )
}
