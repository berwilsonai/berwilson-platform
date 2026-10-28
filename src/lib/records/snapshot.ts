import { createAdminClient } from '@/lib/supabase/admin'
import { dropHidden, hiddenProjectIds } from '@/lib/security/confidential'
import { leafRecords, pipelineValue, portfolioTotal } from '@/lib/records/pipeline-value'
import { weightedValue } from '@/lib/utils/constants'
import { readOpenCommitments } from '@/lib/commitments/read'

/**
 * The weekly portfolio snapshot — the history a KPI tile needs to say which
 * way a number is going.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `StatTile` has shipped a `trend` prop and an inline `Sparkline` since
 * 2026-10-27 and has never once drawn one, because nothing here remembers what
 * a figure was last week. Every number on /dashboard is computed live from the
 * current rows. A delta line was recorded as "not built" for exactly that
 * reason: it is a schema question, not a UI one.
 *
 * ⚠ THE FIGURES ARE COMPUTED THE SAME WAY THE DASHBOARD COMPUTES THEM, through
 * the same helpers — `portfolioTotal`, `leafRecords`, `pipelineValue`,
 * `weightedValue`, `readOpenCommitments`. A snapshot derived by a second route
 * would be a fork, and a delta between a figure and a DIFFERENTLY-derived
 * figure is noise that argues with the number printed above it.
 *
 * ⚠ CONFIDENTIAL PROJECTS ARE EXCLUDED AT WRITE TIME, ABSOLUTELY. §8 makes
 * `confidential` containment: it leaves every cross-portfolio aggregate, for
 * everyone, admins included. `hiddenProjectIds()` with no user is the safe
 * answer by construction — it returns every confidential project and fails
 * closed. And it has to be here rather than at a reader, because a stored
 * total cannot be filtered after the fact: once a protected project's value is
 * inside `pipeline_value`, there is no way to take it back out.
 */
export interface PortfolioSnapshot {
  captured_on: string
  pipeline_value: number | null
  weighted_pipeline_value: number | null
  active_projects: number
  open_commitments: number
  overdue_tasks: number
}

/** Compute today's figures. Reads only — `writeSnapshot` is what stores them. */
export async function computeSnapshot(today = new Date()): Promise<PortfolioSnapshot> {
  const supabase = createAdminClient()
  const captured_on = today.toISOString().slice(0, 10)

  const hidden = await hiddenProjectIds()

  const { data: projectsRaw } = await supabase
    .from('projects')
    .select('id, estimated_value, win_probability, parent_project_id, status')
    .eq('status', 'active')

  const active = dropHidden(projectsRaw ?? [], (p) => p.id, hidden)
  const total = portfolioTotal(active)
  const leaves = leafRecords(active)
  const weighted = leaves.reduce(
    (sum, p) => sum + weightedValue(pipelineValue(p).amount, p.win_probability ?? null),
    0
  )

  const { rows: commitments } = await readOpenCommitments({ limit: 1000 })

  /*
    ⚠ FILTERED IN SQL, BEFORE ANY LIMIT, AND `not.in` IS NULL FOR A NULLABLE
    COLUMN — so a task on no project would vanish from the count entirely if
    the exclusion were written the obvious way. The `or(is null, not in …)`
    shape is the one `dropHidden` matches (§12).
  */
  let overdueQ = supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'done')
    .not('due_date', 'is', null)
    .lt('due_date', captured_on)
  if (hidden.size > 0) {
    overdueQ = overdueQ.or(`project_id.is.null,project_id.not.in.(${[...hidden].join(',')})`)
  }
  const { count: overdue } = await overdueQ

  return {
    captured_on,
    // A rolled-up sum with nothing in it is NULL, not 0 (§12) — otherwise the
    // first real figure reads as a rise from zero rather than from unknown.
    pipeline_value: total.amount,
    weighted_pipeline_value: weighted > 0 ? weighted : null,
    active_projects: active.length,
    open_commitments: commitments.length,
    overdue_tasks: overdue ?? 0,
  }
}

/**
 * Store today's figures.
 *
 * ⚠ UPSERT ON THE DATE. A cron fires more than once — a deploy, a manual run,
 * a launchd catch-up after the box slept — and two rows for one day would
 * double that week in every delta derived from it.
 */
export async function writeSnapshot(today = new Date()): Promise<PortfolioSnapshot> {
  const snapshot = await computeSnapshot(today)
  const { error } = await createAdminClient()
    .from('portfolio_snapshots')
    .upsert(snapshot, { onConflict: 'captured_on' })
  if (error) throw new Error(`Failed to write portfolio snapshot: ${error.message}`)
  return snapshot
}

export interface Delta {
  /** Signed fractional change, e.g. 0.042 for +4.2%. */
  change: number
  /** How long ago the figure it is compared against was captured. */
  sinceDays: number
}

/**
 * The change in one figure against an earlier one.
 *
 * ⚠ RETURNS NULL RATHER THAN ZERO WHEN THERE IS NO HISTORY, and the tile then
 * renders nothing at all. The audit's own instruction is to omit rather than
 * placeholder, and §12 is blunt about why: a placeholder at a value's own
 * weight reads as a failed render. For the first few weeks this shows nothing,
 * which is correct and must not be faked.
 *
 * ⚠ A PRIOR OF ZERO HAS NO PERCENTAGE. Dividing by it yields Infinity, and
 * §12 requires that neither Infinity nor NaN ever reaches the markup.
 */
export function deltaFrom(
  current: number | null | undefined,
  prior: number | null | undefined,
  sinceDays: number
): Delta | null {
  if (current == null || prior == null) return null
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null
  if (prior === 0) return null
  const change = (current - prior) / Math.abs(prior)
  if (!Number.isFinite(change)) return null
  return { change, sinceDays }
}

/** The newest snapshot at least `minAgeDays` old, or null if there is none. */
export async function priorSnapshot(minAgeDays = 7): Promise<PortfolioSnapshot | null> {
  const cutoff = new Date(Date.now() - minAgeDays * 86_400_000).toISOString().slice(0, 10)
  const { data } = await createAdminClient()
    .from('portfolio_snapshots')
    .select(
      'captured_on, pipeline_value, weighted_pipeline_value, active_projects, open_commitments, overdue_tasks'
    )
    .lte('captured_on', cutoff)
    .order('captured_on', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as PortfolioSnapshot | null) ?? null
}

/** Whole days between two `YYYY-MM-DD` dates. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime()
  const b = new Date(`${to}T00:00:00`).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}
