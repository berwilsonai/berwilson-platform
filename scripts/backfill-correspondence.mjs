/**
 * One-off backfill for the 2026-09-09 correspondence work.
 *
 * Four steps, each independently runnable and each idempotent, because the whole
 * thing takes hours and will be interrupted:
 *
 *   refetch  — re-read every thread from Gmail to pull in messages missed since
 *              capture. The hourly catch-up window is capped at 30 days and
 *              cannot reach back far enough on its own.
 *   route    — link threads to the records they belong to.
 *   apply    — write the outstanding correspondence onto those records.
 *   retriage — re-read lead threads under the multi-opportunity prompt, so an
 *              email describing several deals becomes several leads.
 *
 * Usage (from the repo root, on the Studio):
 *   node --experimental-strip-types --import ./scripts/register-alias.mjs \
 *        --env-file=.env.local scripts/backfill-correspondence.mjs [step...]
 *
 * With no arguments it runs refetch, route and apply — the cheap, deterministic
 * steps. `retriage` is opt-in because it is the expensive one: roughly 40s of
 * local model time per thread, and it competes with the hourly sweep.
 */

import { fetchAllMailboxes } from '@/lib/email-sweep/fetch-phase'
import { routeThreads } from '@/lib/email-sweep/route-phase'
import { applyThreadUpdates } from '@/lib/email-sweep/apply-phase'
import { triagePendingLeads } from '@/lib/leads/triage-phase'
import { sweepDb } from '@/lib/email-sweep/db'

const steps = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const run = steps.length > 0 ? steps : ['refetch', 'route', 'apply']
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

if (run.includes('refetch')) {
  // restart:true discards the saved cursor and sinceDays:null reads all history,
  // so this reaches threads that grew outside the normal catch-up window. Threads
  // that have not changed are skipped without a write; only grown ones are
  // updated and re-queued for summarizing.
  log('refetch: deal mailboxes…')
  const deal = await fetchAllMailboxes({
    pipeline: 'deal',
    sinceDays: null,
    restart: true,
    maxPagesPerMailbox: 50,
  })
  for (const p of deal) {
    log(`  ${p.mailbox}: seen=${p.threadsSeen} new=${p.threadsNew} REFRESHED=${p.threadsRefreshed} unchanged=${p.duplicatesSkipped} done=${p.done}`)
  }

  log('refetch: lead mailboxes…')
  const lead = await fetchAllMailboxes({
    pipeline: 'lead',
    sinceDays: null,
    restart: true,
    maxPagesPerMailbox: 50,
  })
  for (const p of lead) {
    log(`  ${p.mailbox}: seen=${p.threadsSeen} new=${p.threadsNew} REFRESHED=${p.threadsRefreshed} unchanged=${p.duplicatesSkipped} done=${p.done}`)
  }
}

if (run.includes('route')) {
  log('route: linking threads to records…')
  let total = { considered: 0, linked: 0, inferred: 0, unmatched: 0 }
  for (;;) {
    const p = await routeThreads({ limit: 500 })
    if (p.threadsConsidered === 0) break
    total.considered += p.threadsConsidered
    total.linked += p.linked
    total.inferred += p.inferred
    total.unmatched += p.unmatched
    log(`  +${p.threadsConsidered} (linked ${p.linked}, inferred ${p.inferred})`)
  }
  log(`  routed ${total.considered}: ${total.linked} linked, ${total.inferred} inferred, ${total.unmatched} unmatched`)
}

if (run.includes('apply')) {
  log('apply: writing correspondence onto records…')
  const total = { links: 0, posted: 0, staged: 0, leads: 0, files: 0, stale: 0, failed: 0 }
  for (;;) {
    // A generous budget: this is the backfill, not the hourly cron, and its
    // whole job is to finish.
    const p = await applyThreadUpdates({ limit: 100, budgetMs: 30 * 60 * 1000 })
    if (p.linksConsidered === 0) break
    total.links += p.linksConsidered
    total.posted += p.updatesPosted
    total.staged += p.updatesStaged
    total.leads += p.leadsTouched
    total.files += p.attachmentsImported
    total.stale += p.staleLinksDropped
    total.failed += p.failed
    log(`  +${p.linksConsidered} (posted ${p.updatesPosted}, staged ${p.updatesStaged}, leads ${p.leadsTouched}, files ${p.attachmentsImported})`)
  }
  log(`  applied ${total.links} links: ${total.posted} posted, ${total.staged} awaiting review, ${total.leads} leads refreshed, ${total.files} files, ${total.stale} stale links dropped, ${total.failed} failed`)
}

if (run.includes('retriage')) {
  // The expensive step. Requeues lead threads so the multi-opportunity prompt
  // re-reads them; a promoted or human-touched lead is never removed by the
  // prune that follows (see pruneSurplusLeads).
  const db = sweepDb()
  const { count } = await db
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .eq('pipeline', 'lead')
    .eq('summary_state', 'summarized')
  log(`retriage: requeueing ${count ?? 0} lead threads (~40s each — expect hours)`)

  await db
    .from('email_threads')
    .update({ summary_state: 'pending' })
    .eq('pipeline', 'lead')
    .eq('summary_state', 'summarized')

  const p = await triagePendingLeads({ budgetMs: 6 * 60 * 60 * 1000 })
  log(`  processed ${p.processed}, ${p.split} threads yielded more than one opportunity, ${p.leads} leads, ${p.rejected} rejected, ${p.failed} failed, ${p.remaining} remaining`)
}

log('done')
