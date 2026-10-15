/**
 * Drop thread_links pointing at a deleted record, once, now.
 *
 * The reaper is part of the apply phase from 2026-10-14 onward, so this script
 * exists only to clear what accumulated before it — ten links to one deleted
 * project, the oldest from 9 September. Runs the SAME function the phase runs,
 * deliberately: a one-shot with its own copy of the logic is a one-shot that
 * proves nothing about the pass that has to keep doing it (§12).
 */
import { applyThreadUpdates } from '@/lib/email-sweep/apply-phase'

// A zero budget means the reaper runs and the batch does not: the deadline is
// already past by the time the link loop is reached, so nothing is applied.
const r = await applyThreadUpdates({ budgetMs: 0, announce: false })
console.log({ staleLinksDropped: r.staleLinksDropped, linksConsidered: r.linksConsidered, outOfTime: r.outOfTime })
