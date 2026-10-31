/**
 * Portfolio Activity — when each deal was last touched, what is owed on it,
 * and which ones have gone quiet.
 *
 * ⚠ THE ONE QUESTION THIS ANSWERS THAT NO OTHER SURFACE DOES: which deals are
 * drifting. `/attention` ranks items that are individually overdue; this ranks
 * DEALS by silence, which is the thing nobody notices because its symptom is
 * an absence. §12's standing finding is that a cleanup which is a side effect
 * of having work to do never reaches the rows with no work — a deal with no
 * open task and no recent mail generates nothing to look at and is therefore
 * invisible on every queue in the app.
 *
 * ⚠ SILENCE IS MEASURED FROM CORRESPONDENCE, NOT FROM `updated_at`. A deal's
 * `updated_at` moves whenever Pepper writes a field, so it measures the
 * platform's activity rather than the company's — every row would read "today"
 * and the column would carry no information at all. The clock here is the last
 * message on a thread linked to the deal, which is the human signal.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { STAGE_LABELS } from '@/lib/utils/constants'
import { phaseLookup, powerTotal } from '@/lib/records/power'

import { registerCoverage, type DealRegister } from '../deals'
import { toCell, type ReportData, type ReportRow } from '../types'

/** Past this many days with no correspondence, a deal is called quiet. */
const QUIET_DAYS = 30

/** And past this, adrift. Banded, because when every row is red red stops signifying (§12). */
const ADRIFT_DAYS = 90

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

interface LinkRow {
  record_id: string
  record_kind: string
  /**
   * ⚠ `last_at`, NOT `last_message_at`. The first draft of this guessed the
   * longer name and PostgREST answered `column email_threads_1.last_message_at
   * does not exist` — the §12 blindness exactly: a `.select()` column list is a
   * STRING, so typecheck, build and the whole suite stayed green and only
   * running the builder against the real database found it. That is why there
   * is a live-build script rather than only unit tests with hand-built rows.
   */
  thread: { last_at: string | null; subject: string | null } | null
}

interface TaskRow {
  project_id: string | null
  status: string
  due_date: string | null
}

interface CommitmentRow {
  project_id: string | null
  opportunity_id: string | null
  side: string
  status: string
  due_date: string | null
}

export async function buildActivityReport(register: DealRegister): Promise<ReportData> {
  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const [links, tasks, commitments] = await Promise.all([
    supabase
      .from('thread_links')
      .select('record_id, record_kind, thread:email_threads(last_at, subject)')
      .range(0, 4999),
    /*
     * ⚠ `.neq('status', 'done')` WOULD DROP A NULL STATUS, and §12 records the
     * mirror of this costing a count of 146 against a real 41. `tasks.status`
     * is NOT NULL here, but the filter is written as an explicit IN over the
     * values that mean open so the predicate survives the column becoming
     * nullable — which is exactly the change nobody greps for.
     */
    supabase.from('tasks').select('project_id, status, due_date').in('status', ['open', 'in_progress']).range(0, 4999),
    supabase
      .from('commitments')
      .select('project_id, opportunity_id, side, status, due_date')
      .eq('status', 'open')
      .range(0, 4999),
  ])

  if (links.error) throw new Error(`Report could not read correspondence links: ${links.error.message}`)
  if (tasks.error) throw new Error(`Report could not read tasks: ${tasks.error.message}`)
  if (commitments.error) throw new Error(`Report could not read commitments: ${commitments.error.message}`)

  const linkRows = (links.data ?? []) as unknown as LinkRow[]
  const taskRows = (tasks.data ?? []) as unknown as TaskRow[]
  const commitmentRows = (commitments.data ?? []) as unknown as CommitmentRow[]

  // Most recent message per deal.
  const lastMessage = new Map<string, string>()
  const threadCount = new Map<string, number>()
  for (const link of linkRows) {
    threadCount.set(link.record_id, (threadCount.get(link.record_id) ?? 0) + 1)
    const at = link.thread?.last_at
    if (!at) continue
    const current = lastMessage.get(link.record_id)
    if (!current || at > current) lastMessage.set(link.record_id, at)
  }

  const phasesOf = phaseLookup(register.phases)

  const rows: ReportRow[] = register.deals.map((deal): ReportRow => {
    const last = lastMessage.get(deal.id) ?? null
    const quietFor = daysSince(last)
    const openTasks = taskRows.filter((task) => task.project_id === deal.id)
    const overdue = openTasks.filter((task) => task.due_date && task.due_date < today).length
    const owed = commitmentRows.filter(
      (row) => (row.project_id ?? row.opportunity_id) === deal.id
    )
    const ours = owed.filter((row) => row.side === 'us').length

    return {
      id: deal.id,
      cells: {
        name: { value: deal.name, href: deal.href },
        stage: STAGE_LABELS[deal.stage],
        capacity: powerTotal([...phasesOf(deal.id)]).megawatts,
        value: deal.estimatedValue,
        threads: threadCount.get(deal.id) ?? 0,
        last,
        quiet:
          quietFor === null
            ? { value: null, label: 'No correspondence', tone: 'critical' }
            : {
                value: quietFor,
                label: `${quietFor} day${quietFor === 1 ? '' : 's'}`,
                /*
                 * ⚠ BANDED, NOT A BLANKET RED. §12: when every row is red, red
                 * has stopped signifying — and with a 30-day bar on a corpus
                 * this size most rows would be. Reserve the colour for what is
                 * still actionable.
                 */
                tone: quietFor >= ADRIFT_DAYS ? 'critical' : quietFor >= QUIET_DAYS ? 'caution' : 'positive',
              },
        tasks: openTasks.length,
        overdue: overdue > 0 ? { value: overdue, tone: 'critical' } : 0,
        owed: owed.length,
        ours: ours > 0 ? { value: ours, tone: 'caution' } : 0,
      },
    }
  })

  // Quietest first — the report's whole job is to surface what nothing else does.
  const ranked = [...rows].sort((a, b) => {
    const q = (row: ReportRow) => {
      const value = toCell(row.cells.quiet).value
      // A deal with no correspondence at all sorts above the longest silence:
      // it is not quiet, it was never loud, and that is the stronger signal.
      return value === null ? Number.POSITIVE_INFINITY : Number(value)
    }
    return q(b) - q(a)
  })

  const quiet = rows.filter((row) => {
    const value = toCell(row.cells.quiet).value
    return value === null || Number(value) >= QUIET_DAYS
  }).length
  const silent = rows.filter((row) => toCell(row.cells.quiet).value === null).length
  const totalOverdue = taskRows.filter((task) => task.due_date && task.due_date < today).length
  const oursOwed = commitmentRows.filter((row) => row.side === 'us').length

  return {
    title: 'Portfolio Activity',
    subtitle: 'Last contact, open work and what has gone quiet',
    coverage: registerCoverage(register),
    withheld: register.withheld,
    sections: [
      {
        kind: 'stats',
        title: 'Where the portfolio stands',
        stats: [
          {
            label: 'Quiet deals',
            value: String(quiet),
            hint: `no correspondence in ${QUIET_DAYS} days, of ${register.deals.length} deals`,
            tone: quiet > 0 ? 'caution' : 'positive',
          },
          {
            label: 'Never corresponded',
            value: silent > 0 ? String(silent) : null,
            empty: 'Every deal has mail',
            hint: 'no thread is linked to these deals at all',
            tone: silent > 0 ? 'critical' : 'positive',
          },
          {
            label: 'Open commitments',
            value: String(commitmentRows.length),
            hint: `${oursOwed} are ours to deliver`,
          },
          {
            label: 'Overdue tasks',
            value: totalOverdue > 0 ? String(totalOverdue) : null,
            empty: 'Nothing overdue',
            hint: `of ${taskRows.length} open`,
            tone: totalOverdue > 0 ? 'critical' : 'positive',
          },
        ],
      },
      {
        kind: 'table',
        title: 'Every deal, quietest first',
        description:
          'Silence is measured from the last message on a linked thread, not from when the record was edited — a record the assistant touched this morning has still not been talked about.',
        columns: [
          { key: 'name', label: 'Deal', format: 'text', width: 32 },
          { key: 'stage', label: 'Stage', format: 'text', width: 16 },
          { key: 'capacity', label: 'Capacity', format: 'mw' },
          { key: 'value', label: 'Value', format: 'money' },
          { key: 'last', label: 'Last contact', format: 'date' },
          { key: 'quiet', label: 'Quiet for', format: 'number' },
          { key: 'threads', label: 'Threads', format: 'number', total: true },
          { key: 'tasks', label: 'Open tasks', format: 'number', total: true, internal: true },
          { key: 'overdue', label: 'Overdue', format: 'number', total: true, internal: true },
          { key: 'owed', label: 'Commitments', format: 'number', total: true, internal: true },
          { key: 'ours', label: 'Ours', format: 'number', total: true, internal: true },
        ],
        rows: ranked,
        totals: true,
        coverage: `${silent} of ${register.deals.length} deals have no linked correspondence at all`,
        empty: 'No deals in the pipeline.',
      },
      {
        kind: 'note',
        title: 'How to read the quiet column',
        body: `Under ${QUIET_DAYS} days is normal traffic. ${QUIET_DAYS}–${ADRIFT_DAYS} days is worth a look. Over ${ADRIFT_DAYS} days, or no correspondence at all, means nobody has spoken about this deal in a quarter — which on a live deal is the finding, and on a dead one is a record that should be closed.`,
        internal: true,
      },
    ],
  }
}
