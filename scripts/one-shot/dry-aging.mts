/**
 * Sweep the aging threshold against the real ledger. Writes nothing.
 *
 * §12: a threshold is measured against the corpus, never chosen — and two
 * identically shaped rows fall either side of any number you pick, so the
 * sweep prints the boundary cases at each candidate rather than only the count.
 */
// ⚠ DEFAULT IMPORT, NOT NAMED. tsx loads `src/lib` modules as CJS namespaces
// and Node's cjs-module-lexer surfaces an `export function` but NOT an
// `export const` — a named import of the threshold fails with "does not
// provide an export named", while the functions beside it resolve fine.
import aging from '@/lib/commitments/aging'

const { runAgingPass, STALE_THREAD_DAYS } = aging

const CANDIDATES = [30, 45, 60, 90]

for (const staleDays of CANDIDATES) {
  const r = await runAgingPass({ dryRun: true, staleDays })
  const mark = staleDays === STALE_THREAD_DAYS ? '  ← configured' : ''
  console.log(
    `\n── ${staleDays} days silent ${'─'.repeat(40)}${mark}\n` +
      `   considered ${r.considered}   eligible ${r.eligible}   ` +
      `kept: snoozed ${r.skippedSnoozed}, chase-grace ${r.skippedChaseGrace}, ` +
      `undatable ${r.skippedUndatable}` +
      (r.truncated ? '\n   ⚠ READ HIT ITS CEILING — there may be more' : '') +
      (r.errors.length ? `\n   errors: ${r.errors.join('; ')}` : '')
  )
  // The closest calls, which are the only ones worth a human's eye.
  for (const s of r.samples.slice(0, 8)) {
    console.log(
      `     ${String(s.silentDays).padStart(4)}d  ${s.side === 'us' ? 'we owe ' : 'they owe'}  ` +
        `${s.wasChased ? '[chased] ' : ''}${s.what.slice(0, 68)}` +
        (s.dueDate ? `  (due ${s.dueDate})` : '')
    )
  }
}
