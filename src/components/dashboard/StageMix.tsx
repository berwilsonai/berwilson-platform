import Link from 'next/link'

import { Panel, PanelHeader } from '@/components/ui/card'
import { STAGES, STAGE_LABELS, formatValue } from '@/lib/utils/constants'
import { leafRecords, pipelineValue } from '@/lib/records/pipeline-value'
import type { ProjectStage } from '@/lib/supabase/types'

/**
 * Where the pipeline sits — count and value, by stage.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Richard's brief named Domo, and the honest reading of that is: a business
 * intelligence dashboard SHOWS A SHAPE, not just totals. Measured 2026-10-27:
 * this application contained ZERO data visualisations of any kind — 97 pages of
 * lists, cards and counts. "$12B across 17 projects" is a true sentence that
 * tells you nothing about whether the portfolio is top-heavy with pursuits or
 * carrying real executing work, which is the first question an executive asks
 * of a pipeline.
 *
 * ── WHY NOT A CHART LIBRARY ─────────────────────────────────────────────────
 * §11 forbids complexity without demonstrated need, and the need here is a row
 * of proportional bars. Recharts is ~90KB and a client boundary on what is
 * otherwise a server component; this is CSS widths on a flex row and stays
 * server-rendered. If a second and third chart arrive and they want axes,
 * revisit it then — on evidence, not in advance.
 *
 * ── THE ARITHMETIC IS NOT LOCAL ─────────────────────────────────────────────
 * ⚠ `leafRecords` AND `pipelineValue`, never `estimated_value` off the row.
 * A program and its sub-projects are both in `projects`, so summing the raw
 * column counts the same money twice — the exact failure `pipeline-value.ts`
 * exists to prevent, and a new reader of that module is the most likely place
 * to reintroduce it.
 */
/** Exactly what this panel reads — a structural subset of `projects`. */
export interface StageMixRecord {
  id: string
  stage: string | null
  parent_project_id?: string | null
  estimated_value?: number | string | null
}

/**
 * The ordinal ramp, one slot per stage, in `STAGES` order.
 *
 * ⚠ INDEXED BY THE STAGE, NEVER BY THE ROW. `rows` is filtered to stages that
 * hold something, so indexing by row position would repaint every surviving
 * bar the moment a stage emptied — the "recolor-on-filter" failure, where a
 * reader who learned "Bid is the dark one" is then misled by their own
 * data changing. Colour follows the entity.
 *
 * ⚠ LITERAL STRINGS, NOT `bg-ordinal-${i}`. A Tailwind class assembled at
 * runtime is a class Tailwind never generated (§12).
 */
const STAGE_FILL: Record<ProjectStage, string> = {
  pursuit: 'bg-ordinal-1',
  capture: 'bg-ordinal-2',
  bid: 'bg-ordinal-3',
  award: 'bg-ordinal-4',
  mobilization: 'bg-ordinal-5',
  execution: 'bg-ordinal-6',
  closeout: 'bg-ordinal-7',
}

export default function StageMix({ records }: { records: readonly StageMixRecord[] }) {
  // Leaves only: a program's value lives in the work beneath it.
  // ⚠ No cast — `leafRecords` is generic, and casting to its parameter type
  // erases the `stage` this panel groups on.
  const leaves = leafRecords(records)

  const rows = STAGES.map((stage) => {
    const inStage = leaves.filter((r) => r.stage === stage)
    let amount = 0
    let priced = 0
    for (const r of inStage) {
      const v = pipelineValue(r)
      if (v.amount != null) {
        amount += v.amount
        priced += 1
      }
    }
    return { stage, count: inStage.length, amount, priced }
  }).filter((r) => r.count > 0)

  // Nothing to shape. A chart of one bar is a number with decoration.
  if (rows.length < 2) return null

  const maxCount = Math.max(...rows.map((r) => r.count))
  const totalCount = rows.reduce((n, r) => n + r.count, 0)

  return (
    <Panel>
      <PanelHeader label="Pipeline by stage" count={`${totalCount} deals`}>
        <Link href="/projects?view=pipeline" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
          Open the board →
        </Link>
      </PanelHeader>
      <div className="px-4 py-3">
        <dl className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.stage} className="flex items-center gap-3">
              <dt className="w-24 shrink-0 truncate text-xs text-muted-foreground">
                {STAGE_LABELS[r.stage as ProjectStage]}
              </dt>
              {/*
                The bar is the TRACK plus a fill, so an empty-ish stage still
                occupies its row and the eye reads the shape down the column
                rather than hunting for where each bar starts.

                ⚠ THE FILL LEFT `--primary` ON 2026-10-27. It was
                `bg-primary/70`, which made this chart one of six unrelated
                jobs terracotta was doing — brand, primary button, selected
                nav, chart fill, progress fill and overdue — and when one
                colour means everything it means nothing. It is now the
                ordinal ramp: one hue, seven monotone steps in `STAGES` order,
                so the pipeline's shape reads before any label does.
              */}
              <dd className="h-5 min-w-0 flex-1 rounded-sm bg-muted">
                <div
                  className={`h-full rounded-sm ${STAGE_FILL[r.stage as ProjectStage]}`}
                  style={{ width: `${Math.max((r.count / maxCount) * 100, 3)}%` }}
                />
              </dd>
              <dd className="tnum w-8 shrink-0 text-right text-xs font-medium text-foreground">{r.count}</dd>
              {/*
                ⚠ THE VALUE SAYS HOW MANY DEALS IT COVERS, or it is a figure a
                reader cannot reconcile with the count beside it — §12: a total
                that covers part of a set must name which part. One priced deal
                out of nine is the usual case here, not the exception.
              */}
              <dd className="tnum w-28 shrink-0 text-right text-xs text-muted-foreground">
                {r.amount > 0 ? (
                  <>
                    {formatValue(r.amount)}
                    {r.priced < r.count ? (
                      <span className="ml-1 opacity-70">({r.priced} of {r.count})</span>
                    ) : null}
                  </>
                ) : (
                  <span className="opacity-60">unpriced</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  )
}
