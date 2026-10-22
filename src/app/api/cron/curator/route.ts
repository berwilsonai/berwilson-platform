/**
 * GET /api/cron/curator
 *
 * Fold what the correspondence already says onto the records, without asking.
 * Driven by a launchd job (com.berwilson.cron-curator).
 *
 * ⚠ THIS IS THE PASS THAT WRITES TO THE CRM UNATTENDED, by Richard's direction
 * of 2026-10-12. Three properties make that safe and none of them is trust:
 * every write carries Pepper's own actor so `log_activity` records who and what
 * the value was before; only fields in src/lib/provenance/fields.ts can be
 * touched at all; and the run RETURNS what it changed, which the morning note
 * reads out. A change nobody is told about is the failure mode this design must
 * not have.
 *
 * ⚠ NO MODEL CALL, SO NO TIMING CONSTRAINT. This was planned as one extraction
 * per record — 26 calls, twenty minutes of a single-threaded box — until the
 * corpus was measured: the sweep's thread summaries are jsonb and already carry
 * location, sector and a people[] array with titles and addresses. It is a read
 * (about 3 seconds), so it can run before the brief rather than queueing behind
 * it. See src/lib/curator/fold.ts.
 *
 * `?dry=1` decides everything and writes nothing. `?force=1` ignores the
 * per-record cursor. `?only=<id|name>` does one record.
 *
 * ⚠ `?housekeeping=1` ADDS THE DUPLICATE FOLD, AND IT IS A CALLER OF AN
 * EXISTING PASS RATHER THAN A SECOND ONE. `dedupePendingSessions` was written
 * 09-14 and given a UI door 10-08 ("Show me what would fold" plans, a second
 * press applies); Richard's 10-12 direction is that it should not need the
 * press. §12: never fork a shared pass — add a caller.
 *
 * ⚠ AND THERE IS DELIBERATELY NO RETIRE-BY-AGE RULE. The plan was to retire
 * staged proposals nobody had confirmed in 30 days — 100 of the 212 pending.
 * Measured first: the oldest are `IAN Acquisition & EMP/Microgrid IDIQ
 * Pursuit`, `Fort Polk Military & Infrastructure Pursuits` and `Myton islanded
 * grid and rail project`. Those are live deals that already exist as records,
 * not junk — a staleness rule would have retired real work and called it
 * cleaning. What makes a staged proposal disposable is that its deal is
 * ALREADY on the books, which is the duplicate fold's question and not a
 * clock's. §12: measure before building; the premise has never once held.
 *
 * Housekeeping is model-heavy (one grouping call per batch, up to a 45-minute
 * budget) so it runs on its own agent at 23:10, clear of the 05:30 chase /
 * 06:20 curate / 06:30 brief / 06:50 note / 07:00 digest block — LM Studio
 * serves one request at a time and a pass holding the model is added to every
 * other caller's wait (§12).
 */

import { NextRequest, NextResponse } from 'next/server'
import { runCurator } from '@/lib/curator/run'
import { dedupePendingSessions } from '@/lib/email-ingestion/dedupe'
import { deferredResponse, interactiveRunInFlight } from '@/lib/ai/run-state'

/** A read over 26 records and their evidence. Seconds, not minutes. */
export const maxDuration = 600

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Stand aside while somebody is waiting on a Ber AI answer.
  //
  // LM Studio serves ONE request at a time (§2), so starting a model-heavy
  // pass now is added directly to the wait of whoever asked. This pass
  // checkpoints, so the next scheduled tick picks up where it left off and
  // nothing is lost by yielding. `?force=1` overrides.
  const waitingOnAnswer = await interactiveRunInFlight()
  if (waitingOnAnswer.busy && !request.nextUrl.searchParams.get('force')) {
    return NextResponse.json(deferredResponse('curator', waitingOnAnswer))
  }


  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dry') === '1' || url.searchParams.get('dryRun') === '1'
  const force = url.searchParams.get('force') === '1'
  const only = url.searchParams.get('only') ?? undefined
  const housekeeping = url.searchParams.get('housekeeping') === '1'

  try {
    const result = await runCurator({ dryRun, force, only })

    // Folded AFTER curation, not before: curating reads the records as they
    // stand, and a fold that merges staged proposals changes the queue rather
    // than the records, so the order costs nothing either way — but a failure
    // in the slow half must not cost the fast half's work.
    const fold = housekeeping
      ? await dedupePendingSessions({ dryRun }).catch((err: unknown) => ({
          error: err instanceof Error ? err.message : String(err),
        }))
      : null

    return NextResponse.json({
      ...result,
      fold,
      // The per-record detail is large and the log is read by a human at a
      // terminal, so the response names the changes and counts the rest.
      outcomes: result.outcomes.map((o) => ({
        kind: o.kind,
        name: o.name,
        written: o.written.map((w) => `${w.label}: ${w.from ?? '(blank)'} -> ${w.to}`),
        proposed: o.proposed.map((w) => `${w.label}: ${w.from ?? '(blank)'} -> ${w.to}`),
      })),
      peopleOutcomes: result.peopleOutcomes.map((p) => ({
        name: p.name,
        written: p.written.map((w) => `${w.label}=${w.to}`),
        proposed: p.proposed.map((w) => `${w.label}=${w.to}`),
      })),
      // ⚠ A count, not the list. §12: an unlabelled count is not a coverage
      // signal — so the list is available in the dry-run script where somebody
      // is actually looking, and the nightly log carries the number.
      unmatchedPeople: result.unmatchedPeople.length,
      // The one pass that creates a record names every record it created. A
      // count alone would be the wrong shape here: these are new rows in the
      // directory, and the reader has to be able to see which.
      contactSweep: result.contactSweep
        ? {
            ...result.contactSweep,
            outcomes: result.contactSweep.outcomes.length,
            created: result.contactSweep.created.map(
              (c) => `${c.name} <${c.email}>${c.phone ? ` ${c.phone}` : ''}`
            ),
          }
        : null,
    })
  } catch (err) {
    // assertPepper throws here rather than writing unattributed. That is the
    // one failure worth 500ing on: everything below it would be logged as
    // "system" and the audit trail that replaces approval would be worthless.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
