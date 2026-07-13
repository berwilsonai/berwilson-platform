/**
 * The waiting-on triple on a task: who owes us something, what, and since when.
 *
 * The three columns are meaningless apart — a blocker with no "what" can't be
 * chased, and an age with no blocker isn't a handoff — so they're always
 * written and cleared together. This lives in lib (not a route file) because
 * both POST /api/tasks and PATCH /api/tasks/[id] need it, and Next route
 * modules can't export helpers.
 */

export interface WaitingOnFields {
  waiting_on_id: string | null
  waiting_on_what: string | null
  waiting_on_since: string | null
}

interface ResolveResult {
  /** Absent when the request didn't touch the handoff at all. */
  fields?: WaitingOnFields
  error?: string
}

/**
 * Read the handoff out of a request body. Setting a blocker requires saying
 * what they owe; clearing the blocker clears the whole triple. `since` defaults
 * to today, so the report can age the handoff without the client tracking it.
 */
export function resolveWaitingOn(body: Record<string, unknown>): ResolveResult {
  if (!('waiting_on_id' in body) && !('waiting_on_what' in body)) return {}

  const id = (body.waiting_on_id as string | null | undefined) || null
  if (!id) {
    return { fields: { waiting_on_id: null, waiting_on_what: null, waiting_on_since: null } }
  }

  const what = typeof body.waiting_on_what === 'string' ? body.waiting_on_what.trim() : ''
  if (!what) {
    return { error: 'Say what you are waiting on them for' }
  }

  const raw = body.waiting_on_since
  const since =
    typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? raw
      : new Date().toISOString().split('T')[0]

  return { fields: { waiting_on_id: id, waiting_on_what: what, waiting_on_since: since } }
}

/**
 * A task can't be blocked on the person doing it — that's a note, not a
 * handoff, and it would show up in the report as someone blocking themselves.
 * Checked against the *effective* values (post-patch), so it also catches
 * reassigning a task to the person it's already waiting on.
 */
export function selfBlockError(
  assigneeId: string | null | undefined,
  waitingOnId: string | null | undefined,
): string | null {
  if (assigneeId && waitingOnId && assigneeId === waitingOnId) {
    return 'A task cannot wait on the person it is assigned to'
  }
  return null
}
