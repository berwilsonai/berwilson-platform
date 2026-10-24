/**
 * EVERY CRON THAT USES THE LOCAL MODEL EITHER STANDS ASIDE OR SAYS WHY NOT.
 *
 * LM Studio serves ONE request at a time (§2), so a sweep that starts while
 * somebody is waiting on a Ber AI answer is added straight to their wait. Nine
 * routes now yield; fourteen deliberately do not.
 *
 * ⚠ THAT SPLIT IS A HAND-WRITTEN ENUMERATION WITH NO REGISTRY BEHIND IT, which
 * §12 says drifts silently — the same shape as the `log_activity()` triggers
 * that `opportunities` sat outside of while forty siblings carried it, found
 * by accident two days running. There is nothing to derive the list FROM here
 * (a cron is a directory, and whether it is model-heavy is a judgement), so the
 * defence is this test: a new cron route must be classified on purpose, with a
 * reason, or the suite fails and names it. The reason is the point — an
 * exemption with no stated reason is how the next one gets added by reflex.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CRON_DIR = 'src/app/api/cron'

/** Stands aside: model-heavy, resumable, and runs during business hours. */
const DEFERS = [
  'email-sweep',
  'lead-sweep',
  'drive-audio-sweep',
  'voice-memo-sweep',
  'notes-sweep',
  'imessage-sweep',
  'drive-sync',
  'curator',
  // ⚠ The clearest case of all: a job is work somebody handed over, and /intel
  // is somebody sitting there waiting. Added 2026-10-24.
  'job-runner',
]

/** Does not stand aside, each for a stated reason. */
const EXEMPT: Record<string, string> = {
  'pepper-note': 'time-critical — the 06:50 morning note, and nobody is asking questions at 06:50',
  'pepper-text': 'time-critical — the 06:45 text, same window',
  'pepper-reply': 'this IS a human waiting on an answer; deferring it would defer the thing the rule protects',
  'meeting-prep': 'time-critical — fires ~20 min before a meeting and is worthless late',
  'daily-brief': 'overnight, outside any plausible interactive window',
  'daily-digest': 'overnight, outside any plausible interactive window',
  'commitment-chase': 'overnight, outside any plausible interactive window',
  'task-sheet': 'no model call — it projects tasks into a Google Sheet',
  'risk-scores': 'no model call — arithmetic over rows already in the database',
  'deal-intake': 'event-driven and rare; a submitted deal form should not wait behind a question',
  'drive-publish': 'no model call — it copies already-written files to Drive',
  'contacts-sync': 'no model call — a directory projection over existing rows',
  'meet-import': 'event-driven; a recorded call arriving is not something to postpone',
  'task-reminder': 'no model call — it reads tasks with a due date and sends a text (added 2026-10-21)',
}

function cronRoutes(): string[] {
  return readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

function source(route: string): string {
  return readFileSync(join(CRON_DIR, route, 'route.ts'), 'utf8')
}

describe('sweep deferral', () => {
  it('classifies every cron route, so a new one cannot be added silently', () => {
    const classified = new Set([...DEFERS, ...Object.keys(EXEMPT)])
    const unclassified = cronRoutes().filter((r) => !classified.has(r))
    assert.deepEqual(
      unclassified,
      [],
      `these cron routes are in neither list — decide whether each should stand aside ` +
        `for an interactive Ber AI question, and add it to DEFERS or to EXEMPT with a reason: ` +
        unclassified.join(', ')
    )
  })

  it('names no route that has since been deleted', () => {
    const present = new Set(cronRoutes())
    const ghosts = [...DEFERS, ...Object.keys(EXEMPT)].filter((r) => !present.has(r))
    assert.deepEqual(ghosts, [], `listed but gone from ${CRON_DIR}: ${ghosts.join(', ')}`)
  })

  it('every deferring route actually calls the guard and returns its response', () => {
    for (const route of DEFERS) {
      const src = source(route)
      assert.match(
        src,
        /interactiveRunInFlight\(\)/,
        `${route} is listed as deferring but never calls interactiveRunInFlight()`
      )
      assert.match(
        src,
        /deferredResponse\(/,
        `${route} checks for an in-flight run but does not return deferredResponse() — ` +
          `a pass that stands aside silently is indistinguishable from one that is broken`
      )
      // The guard must name ITSELF, or every log line reads the same.
      assert.match(
        src,
        new RegExp(`deferredResponse\\('${route}'`),
        `${route} passes the wrong pass name to deferredResponse()`
      )
    }
  })

  it('the guard sits after the auth check, never before it', () => {
    // Reading run state before authenticating would let an unauthenticated
    // caller probe whether anyone is using the assistant.
    for (const route of DEFERS) {
      const src = source(route)
      const auth = src.indexOf('status: 401')
      const guard = src.indexOf('interactiveRunInFlight()')
      assert.ok(auth >= 0, `${route} has no CRON_SECRET check at all`)
      assert.ok(
        auth < guard,
        `${route} calls interactiveRunInFlight() before rejecting an unauthenticated caller`
      )
    }
  })

  it('every exemption carries a reason', () => {
    for (const [route, reason] of Object.entries(EXEMPT)) {
      assert.ok(
        reason.trim().length > 20,
        `${route} is exempt with no real reason given — say why, or make it defer`
      )
    }
  })

  it('no exempt route quietly started using the guard', () => {
    // Not a failure so much as a sign the lists disagree with the code; the
    // fix is to move the route, not to delete the assertion.
    for (const route of Object.keys(EXEMPT)) {
      assert.doesNotMatch(
        source(route),
        /interactiveRunInFlight\(\)/,
        `${route} is listed as exempt but calls the guard — move it to DEFERS`
      )
    }
  })
})
