/**
 * `logEntry` writes the same thing on both record kinds — against the live
 * database, with real rows, cleaned up afterwards.
 *
 * ⚠ THIS IS THE CHECK THAT MATTERS, because the bug it closes was invisible
 * from every other angle: typing a note on an opportunity embedded the text
 * and did nothing else, so the screen looked right, `tsc` was happy, and the
 * only symptom was follow-up work that never appeared on the board. A test
 * that builds the row directly cannot catch a producer that never fills it
 * (§12) — so this calls the producer.
 *
 * Run (the loader matters — see below):
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --env-file=.env.local --import ./deploy/register.mjs \
 *     scripts/verify-log-entry.mts
 *
 * ⚠ IT IS THE LOADER, NOT THE IMPORT. §12 records that a script importing
 * `src/lib` cannot reliably named-import from it and says to add a default
 * export. Under `npx tsx` that prescription is wrong twice over, and both
 * failures were reproduced here before the real cause was found: `import
 * { logEntry }` throws "does not provide an export named 'logEntry'" on a
 * plain `export function`; appending `.ts` to the path does not help; and a
 * default export merely moves the failure one step, to "logEntry is not a
 * function", because tsx resolves the module as CJS and the ESM namespace
 * then holds `{ default, 'module.exports' }` with the real exports nested
 * inside `default`. Run it under the repo's own `deploy/register.mjs` — the
 * loader `npm test` already uses — and a named import resolves normally.
 *
 * The Supabase client is still built inline rather than imported from
 * `@/lib/supabase/admin`: that one is an `export const`, which is the half of
 * the §12 rule that does hold.
 */

import { createClient } from '@supabase/supabase-js'
import { logEntry } from '../src/lib/records/log-entry'
import type { Database } from '../src/types/database'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)
const STAMP = `verify-log-entry ${Date.now()}`

const extraction = {
  rawContent: `${STAMP}\n\nSpoke to the seller's counsel. They want the PSA closing pushed to 1 Nov and will send a redline Friday. Financing contingency is the open risk — the lender has not confirmed the appraisal date.`,
  summary: 'Seller counsel wants closing pushed to 1 Nov; redline Friday; financing contingency unresolved.',
  actionItems: [
    { text: `${STAMP} — review the PSA redline`, assignee: 'Richard', due_date: '2026-11-01' },
    { text: `${STAMP} — chase the lender on the appraisal date`, assignee: null, due_date: null },
  ],
  waitingOn: [{ text: 'Redline from seller counsel', party: 'Seller counsel', since: '2026-10-18' }],
  risks: [{ text: 'Financing contingency unresolved', severity: 'critical', mitigation: null }],
  decisions: [{ text: 'Push the PSA closing to 1 Nov', made_by: 'Richard', date: '2026-10-18' }],
  confidence: 0.82,
  author: 'verify-log-entry',
}

const cleanup: (() => Promise<void>)[] = []

try {
  // ── An opportunity ───────────────────────────────────────────────────────
  const { data: opp } = await admin.from('opportunities').select('id, name').limit(1).single()
  if (!opp) throw new Error('no opportunity in the database to test against')

  console.log(`\nOpportunity — ${opp.name}\n`)
  const oppResult = await logEntry(admin, { kind: 'opportunity', id: opp.id }, extraction)
  cleanup.push(async () => { await admin.from('opportunity_notes').delete().eq('id', oppResult.id) })

  check('it lands in opportunity_notes', oppResult.table === 'opportunity_notes', oppResult.table)

  const { data: note } = await admin
    .from('opportunity_notes')
    .select('body, author, summary, waiting_on, risks, decisions, confidence')
    .eq('id', oppResult.id)
    .single()

  check('the raw text is the record', note?.body?.includes('seller') === true)
  check('the summary is stored', note?.summary === extraction.summary)
  check('the author is stamped', note?.author === 'verify-log-entry')
  check('confidence is stored', Number(note?.confidence) === 0.82, String(note?.confidence))
  check('waiting_on survived as an array', Array.isArray(note?.waiting_on) && note!.waiting_on.length === 1)
  check('risks survived, with the severity', JSON.stringify(note?.risks).includes('critical'))
  check('decisions survived', JSON.stringify(note?.decisions).includes('1 Nov'))

  // ⚠ The half that was entirely missing before: action items → real tasks on
  // the board, hung off the OPPORTUNITY.
  check('both action items became tasks', oppResult.tasksCreated === 2, `${oppResult.tasksCreated} created`)
  const { data: oppTasks } = await admin
    .from('tasks')
    .select('id, title, project_id, opportunity_id, due_date, assignee_id')
    .like('title', `${STAMP}%`)
  cleanup.push(async () => { await admin.from('tasks').delete().like('title', `${STAMP}%`) })

  check('the tasks hang off the opportunity', (oppTasks ?? []).every((t) => t.opportunity_id === opp.id))
  check('and NOT off a project', (oppTasks ?? []).every((t) => t.project_id === null))
  check('the due date carried through', (oppTasks ?? []).some((t) => t.due_date === '2026-11-01'))
  check('a named assignee resolved', (oppTasks ?? []).some((t) => t.assignee_id !== null))
  check('an unnamed assignee stayed unassigned', (oppTasks ?? []).some((t) => t.assignee_id === null))

  // Saved as-is: no summary, no extraction, still a record and still indexed.
  const asIs = await logEntry(admin, { kind: 'opportunity', id: opp.id }, {
    rawContent: `${STAMP} saved as-is — called Merlin, no answer, will try Monday.`,
    author: 'verify-log-entry',
  })
  cleanup.push(async () => { await admin.from('opportunity_notes').delete().eq('id', asIs.id) })
  const { data: plain } = await admin
    .from('opportunity_notes')
    .select('summary, confidence, waiting_on, risks, decisions')
    .eq('id', asIs.id)
    .single()
  check('saved as-is stores a NULL summary, not an empty string', plain?.summary === null)
  check('saved as-is stores a NULL confidence', plain?.confidence === null)
  check(
    'saved as-is leaves the arrays empty, never null',
    Array.isArray(plain?.waiting_on) && plain!.waiting_on.length === 0 &&
    Array.isArray(plain?.risks) && Array.isArray(plain?.decisions),
  )
  check('nothing became a task', asIs.tasksCreated === 0)

  // ── A project, unchanged ─────────────────────────────────────────────────
  const { data: proj } = await admin.from('projects').select('id, name').eq('status', 'active').limit(1).single()
  if (!proj) throw new Error('no active project to test against')

  console.log(`\nProject — ${proj.name}\n`)
  const projResult = await logEntry(admin, { kind: 'project', id: proj.id }, {
    ...extraction,
    actionItems: [{ text: `${STAMP} — project arm task`, assignee: null, due_date: null }],
  })
  cleanup.push(async () => { await admin.from('updates').delete().eq('id', projResult.id) })

  check('it lands in updates', projResult.table === 'updates', projResult.table)
  const { data: upd } = await admin
    .from('updates')
    .select('project_id, source, review_state, summary, risks, confidence')
    .eq('id', projResult.id)
    .single()
  check('it is a manual_paste', upd?.source === 'manual_paste')
  check('it is approved, so every reader sees it', upd?.review_state === 'approved')
  check('the summary is stored', upd?.summary === extraction.summary)
  check('risks survived', JSON.stringify(upd?.risks).includes('critical'))
  check('the action item became a task', projResult.tasksCreated === 1)
  const { data: projTasks } = await admin
    .from('tasks')
    .select('project_id, opportunity_id')
    .like('title', `${STAMP} — project arm%`)
  check('the task hangs off the project', (projTasks ?? []).every((t) => t.project_id === proj.id))
  check('and NOT off an opportunity', (projTasks ?? []).every((t) => t.opportunity_id === null))

  // ── Both arms produced the SAME shape ────────────────────────────────────
  console.log('\nThe two arms agree\n')
  check(
    'the same payload yields the same summary on both',
    note?.summary === upd?.summary,
  )
  check(
    'and the same risks on both',
    JSON.stringify(note?.risks) === JSON.stringify(upd?.risks),
  )
} finally {
  // ⚠ NOT process.exit() here — a `finally` that exits swallows the throw it is
  // unwinding (§12), and that cost real hours once already.
  for (const undo of cleanup.reverse()) {
    try { await undo() } catch (err) { console.error('cleanup failed:', err) }
  }
  const { count } = await admin
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .like('title', `${STAMP}%`)
  console.log(`\ncleanup: ${count ?? 0} test task(s) left behind (expect 0)`)
  if ((count ?? 0) > 0) failures++
  // ⚠ A `chunks_update_id_fkey` error may print AFTER the summary. That is
  // this script's own cleanup winning a race with the fire-and-forget embed,
  // not a fault: `logEntry` deliberately does not await indexing, because the
  // text is the record and the index is derived from it. Indexing itself is
  // unchanged by this work and is deliberately NOT asserted here — it would
  // make the check depend on LM Studio, which serves one request at a time
  // and would queue behind whatever cron is running (§12).
}

console.log(failures === 0 ? '\nAll checks passed\n' : `\n${failures} check(s) failed\n`)
process.exitCode = failures === 0 ? 0 : 1
