/**
 * Refresh the task sheet soon after something changed, without making the
 * caller wait.
 *
 * The 15-minute cron alone would be enough for correctness, but not for trust:
 * a task assigned at 9am that does not show up in the sheet until the next tick
 * teaches people the sync is unreliable, and a to-do list nobody believes is
 * worse than none. This is the same bargain `queueTaskPush` struck for Google
 * Tasks, and it replaces it.
 *
 * WHY IT IS SIMPLER THAN THE THING IT REPLACED
 *
 * `queueTaskPush` debounced PER TASK and then synced the one member who owned
 * it, because Google Tasks has a list per person. A sheet is one artifact, so
 * there is nothing to key on: every change wants the same whole-board rebuild,
 * and a burst of ten of them wants exactly one. That also removes the remote
 * cleanup entirely — a deleted task needed a Google task deleting out of
 * somebody's list, where here it simply is not redrawn.
 *
 * THE IN-FLIGHT LATCH IS NOT DECORATION. A rebuild reads the Done column,
 * settles what it says, and then rewrites every tab. Two overlapping passes
 * cannot double-settle (the update is guarded on the task's current status) but
 * they can interleave a read with the other's write and leave the sheet
 * momentarily showing a row that was just settled. Collapsing to one pass at a
 * time, with a `dirty` flag so a change arriving mid-pass is not simply lost,
 * costs four lines.
 */

import { isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { syncTaskSheetQuietly } from '@/lib/tasks/sheet'

/**
 * Long enough to collapse a burst of field-by-field autosaves.
 *
 * TaskDetailSheet saves each field on its own blur — title, assignee, due date,
 * what/why/how — so editing three fields in a few seconds fires three PATCHes.
 * Carried over from `queueTaskPush`, where it was measured against that UI.
 */
const DEBOUNCE_MS = 4_000

/**
 * Module scope, which is safe here and would not be on a serverless host: the
 * platform runs as a long-lived `next start`, so the timer lives to fire.
 */
let timer: NodeJS.Timeout | null = null
let running = false
let dirty = false

async function run(): Promise<void> {
  if (running) {
    dirty = true
    return
  }
  running = true
  try {
    do {
      dirty = false
      await syncTaskSheetQuietly()
      // A change that landed while the pass was writing gets its own pass,
      // rather than waiting fifteen minutes for the cron to notice.
    } while (dirty)
  } finally {
    running = false
  }
}

/**
 * Queue a rebuild, collapsing a burst of saves into one.
 *
 * The `.catch()` is mandatory rather than tidy: an unhandled rejection in a
 * detached promise can take the whole Node process down. `syncTaskSheetQuietly`
 * already swallows everything, so this is belt and braces on the latch itself.
 */
export function queueTaskSheetRefresh(): void {
  if (!isGoogleConfigured()) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void run().catch((err) =>
      console.warn('[tasks/sheet] refresh failed:', err instanceof Error ? err.message : err)
    )
  }, DEBOUNCE_MS)
  // Do not hold the process open for a debounce timer.
  timer.unref?.()
}
