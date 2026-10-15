/**
 * Run the aging pass TWICE and assert the second run reports nothing.
 *
 * §12: pair every pass of this shape with a script that calls it twice and
 * asserts the second run reports no work — a pass that reports what it did
 * must read before it writes, or it claims work it did not do.
 */
import aging from '@/lib/commitments/aging'
const { runAgingPass } = aging

const before = await runAgingPass({ dryRun: true })
console.log('dry run  :', {
  considered: before.considered,
  eligible: before.eligible,
  chaseGrace: before.skippedChaseGrace,
})

const first = await runAgingPass()
console.log('run 1    :', { eligible: first.eligible, retired: first.retired, failed: first.failed })
if (first.errors.length) console.log('  errors :', first.errors)

const second = await runAgingPass()
console.log('run 2    :', { eligible: second.eligible, retired: second.retired })

if (second.retired !== 0 || second.eligible !== 0) {
  console.error(
    `\n✗ NOT IDEMPOTENT — the second run found ${second.eligible} eligible and retired ` +
      `${second.retired}. A row it closed is still being selected, which means the ` +
      `candidate filter and the write disagree about what "retired" means.`
  )
  process.exitCode = 1
} else {
  console.log(`\n✓ idempotent — ${first.retired} retired, second run found nothing left to do`)
}

/**
 * And the undo must HOLD — the check that caught the real bug.
 *
 * Reopening restores a row to exactly the state the pass selects (open, on a
 * conversation that is still silent), so before `reopened_at` existed the undo
 * worked once and the next run closed it again. Twice is not enough to see
 * that; it needs a reopen between two runs.
 */
import settle from '@/lib/commitments/settle'
import list from '@/lib/commitments/list'

const retiredView = await list.listCommitments({ view: 'retired' }, null)
if (retiredView.items.length === 0) {
  console.log('\n(no retired rows to test the undo against)')
} else {
  const victim = retiredView.items[0]
  await settle.settleCommitment(victim.id, 'open', 'verify-aging')
  const after = await runAgingPass()
  const live = await list.listCommitments({ view: 'open' }, null)
  const held = live.items.some((i) => i.id === victim.id)
  console.log(
    held
      ? `✓ the undo holds — reopened row survived a pass (${after.skippedReopened} exempt)`
      : '✗ the undo is a loop — a reopened row was closed again on the next run'
  )
  if (!held) process.exitCode = 1
}
