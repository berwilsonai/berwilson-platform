/** Read-only: does the text sweep still consider the snapshot stale? */
import { runIMessageSweep } from '@/lib/imessage/sweep'
const r = await runIMessageSweep({ dryRun: true })
console.log({
  ok: r.ok,
  reason: r.reason,
  chatsRead: r.chatsRead,
  business: r.business,
  tapbacksDropped: r.tapbacksDropped,
  sessions: r.sessions,
  // the staleness fields the health page watches
  ...('snapshotAgeMinutes' in r ? { snapshotAgeMinutes: (r as Record<string, unknown>).snapshotAgeMinutes } : {}),
  ...('stale' in r ? { stale: (r as Record<string, unknown>).stale } : {}),
  ...('error' in r ? { error: (r as Record<string, unknown>).error } : {}),
})
