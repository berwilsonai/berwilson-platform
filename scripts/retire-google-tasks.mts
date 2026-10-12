/**
 * Clear the platform's tasks out of moose@'s and tuaone@'s Google Tasks lists.
 *
 * ⚠ RUN THIS ONCE, AFTER THE TASK SHEET IS WORKING. The Google Tasks sync was
 * replaced by the shared sheet on 2026-10-11, and 39 tasks it had already
 * pushed are sitting in two personal to-do lists that will never update again.
 * A frozen to-do list does not look frozen — it looks like a to-do list — which
 * is the §12 orphaned-projection failure in the worst possible place: somebody
 * works the stale list and re-does finished work, or trusts a due date that
 * moved a week ago.
 *
 * WHY DELETING IS THE RIGHT VERB HERE, UNUSUALLY. This repo's standing rule is
 * that a row is the tombstone and a delete is almost always the wrong verb. It
 * does not apply: these are not records, they are COPIES this platform created
 * of records that still exist in full on the board. The original is safe, the
 * projection is what is being withdrawn, and `queueTaskRemoval` drew exactly
 * this line before it was deleted — "we created it, and the thing it referred
 * to is gone".
 *
 * Standalone of the app's task modules, which no longer exist. It reads the
 * RENAMED link tables the migration preserved for this purpose.
 *
 * ⚠ IT NEEDS THE `tasks` SCOPE, WHICH THE SOURCE NO LONGER ASKS FOR. Tokens
 * minted before 2026-10-11 still carry it — removing a scope from the list
 * changes nothing about what is already stored (§12). So this works today and
 * stops working the moment either mailbox re-consents. If that has already
 * happened, the script says so rather than reporting 39 silent failures.
 *
 * Run (dry run — reads both sides, changes nothing):
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/retire-google-tasks.mts
 *
 * Then, to actually delete:
 *   … scripts/retire-google-tasks.mts --apply
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { googleFetch, hasStoredCredential } from '@/lib/integrations/google-workspace'

const APPLY = process.argv.includes('--apply')
const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1'
/** Tasks meters per minute like Gmail does; 39 deletes need no hurry. */
const PACE_MS = 200

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[1m', D = '\x1b[2m', O = '\x1b[0m'

const LINKS = '_bw_dropped_task_google_links_20261011'
const LISTS = '_bw_dropped_google_task_lists_20261011'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const admin = createAdminClient()

interface Link {
  id: string
  task_id: string
  team_member_id: string
  google_list_id: string
  google_task_id: string
  state: string
}

const { data: linkData, error: linkErr } = await admin
  .from(LINKS as 'tasks')
  .select('id, task_id, team_member_id, google_list_id, google_task_id, state')
if (linkErr) {
  console.error(`${R}Could not read ${LINKS}: ${linkErr.message}${O}`)
  console.error('If the table is gone, this script has already been run and can be deleted.')
  process.exit(1)
}

const { data: listData, error: listErr } = await admin
  .from(LISTS as 'tasks')
  .select('team_member_id, mailbox')
if (listErr) {
  console.error(`${R}Could not read ${LISTS}: ${listErr.message}${O}`)
  process.exit(1)
}

const mailboxByMember = new Map(
  (listData as unknown as { team_member_id: string; mailbox: string }[]).map((r) => [
    r.team_member_id,
    r.mailbox,
  ])
)

const links = (linkData as unknown as Link[]) ?? []

// `detached` means the member already cleared it off their own list — the sync
// obeying them, not a fault. Deleting it again would 404 and read as an error.
const active = links.filter((l) => l.state === 'active')
const detached = links.length - active.length

console.log(`\n${B}Retiring the Google Tasks projection${O}`)
console.log(`${D}${APPLY ? 'APPLY — tasks will be deleted' : 'DRY RUN — nothing will be deleted'}${O}\n`)
console.log(`  ${links.length} link row${links.length === 1 ? '' : 's'} preserved by the migration`)
console.log(`  ${active.length} still active, ${detached} already cleared off a list by hand\n`)

// Group by mailbox so the report reads per person, and so one missing
// credential does not look like a per-task failure.
const byMailbox = new Map<string, Link[]>()
const orphaned: Link[] = []
for (const link of active) {
  const mailbox = mailboxByMember.get(link.team_member_id)
  if (!mailbox) {
    orphaned.push(link)
    continue
  }
  const bucket = byMailbox.get(mailbox) ?? []
  bucket.push(link)
  byMailbox.set(mailbox, bucket)
}

if (orphaned.length > 0) {
  console.log(`${Y}  ${orphaned.length} link row(s) name a member with no stored list — skipped.${O}\n`)
}

let deleted = 0
let alreadyGone = 0
let failed = 0

for (const [mailbox, rows] of byMailbox) {
  console.log(`${B}${mailbox}${O} — ${rows.length} task${rows.length === 1 ? '' : 's'}`)

  if (!hasStoredCredential(mailbox)) {
    console.log(`${Y}  no stored credential; skipped${O}\n`)
    failed += rows.length
    continue
  }

  // Probe the scope ONCE per mailbox rather than discovering it 20 times. A
  // re-consent since 2026-10-11 has dropped the `tasks` scope, and that is one
  // sentence to report, not twenty identical 403s.
  if (APPLY) {
    try {
      await googleFetch(`${TASKS_BASE}/users/@me/lists?maxResults=1`, mailbox)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`${Y}  cannot reach Google Tasks: ${message.slice(0, 160)}${O}`)
      console.log(
        `${D}  If this says the consent predates a scope, this mailbox has re-consented\n` +
          `  since the sync was removed and the leftovers must be cleared by hand in\n` +
          `  the Google Tasks UI.${O}\n`
      )
      failed += rows.length
      continue
    }
  }

  for (const link of rows) {
    if (!APPLY) {
      console.log(`${D}  would delete ${link.google_task_id} (task ${link.task_id.slice(0, 8)})${O}`)
      continue
    }
    try {
      await googleFetch(
        `${TASKS_BASE}/lists/${encodeURIComponent(link.google_list_id)}/tasks/` +
          `${encodeURIComponent(link.google_task_id)}`,
        mailbox,
        { method: 'DELETE' }
      )
      deleted++
      console.log(`${G}  ✓${O} ${link.google_task_id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Already gone is the goal, not a failure — the member may have ticked it
      // off themselves between the last sync and now.
      if (/\b(404|410)\b/.test(message)) {
        alreadyGone++
        console.log(`${D}  · ${link.google_task_id} was already gone${O}`)
      } else {
        failed++
        console.log(`${R}  ✗${O} ${link.google_task_id}: ${message.slice(0, 120)}`)
      }
    }
    await sleep(PACE_MS)
  }
  console.log()
}

if (!APPLY) {
  console.log(`${B}Dry run.${O} Re-run with ${B}--apply${O} to delete them.\n`)
  process.exit(0)
}

console.log(`${B}Done.${O} ${deleted} deleted, ${alreadyGone} already gone, ${failed} failed.`)
if (failed === 0) {
  console.log(
    `${D}Nothing is left in either list. Both ${LINKS} and ${LISTS} can now be\n` +
      `dropped, and this script deleted with them.${O}\n`
  )
} else {
  console.log(`${Y}Leave the tables in place and re-run; they are the only record of what is left.${O}\n`)
}
