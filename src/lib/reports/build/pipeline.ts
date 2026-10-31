/**
 * Pipeline Summary — every deal, what stage it is at, what it is worth and how
 * much power it carries.
 *
 * ⚠ THIS REPORT IS MOSTLY EMPTY TODAY AND IT SAYS SO ON ITS OWN FACE. Measured
 * 2026-10-31 against the live database: 35 deals, 2 with an estimated value, 2
 * with a win probability, 0 with a ramp-up schedule. §12's first instruction is
 * to measure the data's SHAPE before building, and the shape here is a register
 * that is rich in who/where/what-stage and almost bare on money and megawatts.
 *
 * The temptation is to drop the empty columns. That is the wrong move and §12
 * names it: *"A SURFACE HIDDEN BECAUSE IT IS EMPTY IS HIDDEN EXACTLY WHEN
 * SOMEONE NEEDS TO FILL IT."* The megawatt column is the key metric Richard
 * asked for and its emptiness is an open item on his own list. So the columns
 * stay, every total carries its coverage, and the report states the gap in
 * words rather than rendering thirty-three em dashes and looking broken.
 */

import {
  STAGE_LABELS,
  STAGE_PIPELINE,
  STAGE_CLOSED,
  SECTOR_LABELS,
  enumLabel,
  formatValue,
  weightedValue,
  winBandLabel,
} from '@/lib/utils/constants'
import { coverageNote, portfolioTotal } from '@/lib/records/pipeline-value'
import {
  formatMegawatts,
  phaseLookup,
  portfolioPower,
  powerCoverageNote,
  subtreePower,
} from '@/lib/records/power'
import type { DealStage } from '@/lib/supabase/types'
import type { Tone } from '@/lib/ui/tone'

import { registerCoverage, type DealRegister, type DealRow } from '../deals'
import type { NoteSection, ReportColumn, ReportData, ReportRow, RowGroup } from '../types'

/**
 * A stage's chip tone.
 *
 * ⚠ DELIBERATELY NOT `STAGE_BADGE`, WHICH IS CLASS STRINGS. A report cell
 * carries a tone NAME and the renderer resolves it (`src/lib/ui/tone.ts`), so
 * the same `ReportData` can render as a chip on screen, as plain text in a
 * spreadsheet and as ink on paper. §12: store a tone name against a palette
 * declared literally in source. Typed `Record<DealStage, Tone>`, so adding a
 * stage is a build error here rather than an unstyled chip.
 */
const STAGE_TONE: Record<DealStage, Tone> = {
  prospecting: 'neutral',
  in_discussions: 'info',
  due_diligence: 'violet',
  contracting: 'caution',
  won: 'positive',
  lost: 'critical',
}

/** Stage order for the report: the four open lanes, then the terminal pair. */
const STAGE_ORDER: DealStage[] = [...STAGE_PIPELINE, ...STAGE_CLOSED]

export function buildPipelineReport(register: DealRegister): ReportData {
  const { deals } = register
  const phasesOf = phaseLookup(register.phases)

  /*
   * ⚠ POWER AND VALUE ARE BOTH ROLLED UP THROUGH THE HIERARCHY, NEVER SUMMED
   * OFF THE ROWS. A program carrying 900 MW beside three sites carrying 300
   * each is 1,800 MW in any naive total, and that is a number nobody can
   * defend. `portfolioPower` and `portfolioTotal` walk subtrees from the roots
   * so each deal counts once — and they judge a root by whether its parent is
   * PRESENT IN THE SAME SET, which is what keeps a child correct after a
   * confidential parent has been withheld.
   */
  const power = portfolioPower(register.rollupSet, phasesOf)
  const value = portfolioTotal(register.rollupSet)

  // The one number a reader asks of a pipeline: value × likelihood. Internal —
  // a probability-weighted figure is a judgement about our own chances and is
  // not something to hand a counterparty.
  const weighted = deals.reduce(
    (sum, deal) => sum + weightedValue(deal.estimatedValue, deal.winProbability),
    0
  )

  /*
   * ⚠ WHY THE DENOMINATOR IS NOT THE DEAL COUNT, SAID OUT LOUD. The totals
   * roll a sub-project into its parent, so a 35-deal portfolio has 34 leaves
   * and the tiles read "2 of 34 priced" under a header saying 35. That gap is
   * correct and completely opaque — `PortfolioTotal.rolledUp` exists to be
   * shown, and its own comment says why: *"a total over 50 deals that silently
   * covers 44 is the kind of unexplained figure this module exists to stop."*
   */
  const rolledNote =
    value.rolledUp > 0
      ? `${value.rolledUp} sub-project${value.rolledUp === 1 ? '' : 's'} rolled into ${value.rolledUp === 1 ? 'its parent' : 'their parents'}`
      : null

  const columns: ReportColumn[] = [
    { key: 'name', label: 'Deal', format: 'text', width: 34 },
    { key: 'type', label: 'Type', format: 'text', width: 14 },
    { key: 'sector', label: 'Sector', format: 'text', width: 20 },
    { key: 'location', label: 'Location', format: 'text', width: 22 },
    { key: 'client', label: 'Counterparty', format: 'text', width: 26 },
    { key: 'capacity', label: 'Capacity', format: 'mw', total: true },
    { key: 'value', label: 'Value', format: 'money', total: true },
    // ⚠ INTERNAL. The band is our own read on whether we win it; a weighted
    // figure is that read turned into a number. Neither belongs in a document
    // that leaves the building, and `applyAudience` strips both.
    { key: 'pwin', label: 'Win band', format: 'text', internal: true, width: 12 },
    { key: 'weighted', label: 'Weighted', format: 'money', total: true, internal: true },
    { key: 'bid', label: 'Bid due', format: 'date' },
    { key: 'target', label: 'Target', format: 'date' },
  ]

  const rowFor = (deal: DealRow): ReportRow => {
    /*
     * ⚠ A PROGRAM REPORTS ITS LEAVES' CAPACITY, NOT ITS OWN AS WELL, and the
     * only way to get that right per-row is `subtreePower` — the same function
     * the deal's own page calls. A row computing `powerTotal(its own phases)`
     * would show a program 900 MW where its page showed its sites' 600, which
     * is §12's opening rule: one quantity, one definition.
     */
    const own =
      deal.kind === 'project'
        ? subtreePower(
            register.rollupSet.find((h) => h.id === deal.id) ?? {
              id: deal.id,
              parent_project_id: null,
              estimated_value: deal.estimatedValue,
            },
            register.rollupSet,
            phasesOf
          )
        : null

    const megawatts = own ? own.megawatts : sumPhases(phasesOf(deal.id))
    const band = winBandLabel(deal.winProbability)
    /*
     * ⚠ NULL WHERE EITHER HALF IS MISSING, NEVER 0. `weightedValue` returns 0
     * for an absent probability, which is right for a SUM — an unknown cannot
     * be added — and wrong for a CELL: the first render showed Alaska at
     * "$95M · $0 weighted", stating that a deal nobody has scored is worth
     * nothing. §12: a rolled-up sum with nothing in it is NULL, not 0, and a
     * money figure must carry its shape. Caught in the screenshot.
     */
    const weightedOwn =
      deal.estimatedValue === null || deal.winProbability === null
        ? null
        : weightedValue(deal.estimatedValue, deal.winProbability)

    return {
      id: deal.id,
      cells: {
        name: { value: deal.name, href: deal.href },
        type: deal.kind === 'project' ? 'Project' : 'Opportunity',
        sector: enumLabel(deal.sector, SECTOR_LABELS, { empty: '' }) || null,
        location: deal.location,
        client: deal.client,
        capacity: megawatts,
        value: deal.estimatedValue,
        pwin: band,
        weighted: weightedOwn,
        bid: deal.bidDueDate,
        target: deal.targetDate,
      },
      detail: own?.rolled ? `Program — capacity rolled up from ${own.leaves} sub-projects` : undefined,
    }
  }

  const groups: RowGroup[] = STAGE_ORDER.map((stage): RowGroup | null => {
    const inStage = deals.filter((deal) => deal.stage === stage)
    if (inStage.length === 0) return null
    const stagePower = portfolioPower(
      register.rollupSet.filter((h) => inStage.some((d) => d.id === h.id)),
      phasesOf
    )
    const stageValue = inStage.reduce((sum, d) => sum + (d.estimatedValue ?? 0), 0)
    const priced = inStage.filter((d) => d.estimatedValue !== null).length
    return {
      label: STAGE_LABELS[stage],
      tone: STAGE_TONE[stage],
      rows: inStage.map(rowFor),
      summary: [
        `${inStage.length} deal${inStage.length === 1 ? '' : 's'}`,
        stagePower.megawatts > 0 ? formatMegawatts(stagePower.megawatts) : null,
        priced > 0 ? formatValue(stageValue) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    }
  }).filter((group): group is RowGroup => group !== null)

  const pricedCount = deals.filter((deal) => deal.estimatedValue !== null).length

  return {
    title: 'Pipeline Summary',
    subtitle: 'Every live deal, by stage — capacity, value and the dates that move',
    coverage: registerCoverage(register),
    withheld: register.withheld,
    sections: [
      {
        kind: 'stats',
        title: 'The portfolio',
        stats: [
          {
            label: 'Deals',
            value: String(deals.length),
            hint: `${deals.filter((d) => d.kind === 'project').length} projects · ${deals.filter((d) => d.kind === 'opportunity').length} opportunities`,
          },
          {
            label: 'Capacity',
            value: power.megawatts > 0 ? formatMegawatts(power.megawatts) : null,
            // ⚠ NEVER A BARE EM DASH AT A VALUE'S OWN WEIGHT (§12) — it reads
            // as a failed render. The absence is named in words instead, and
            // the words say what to do about it.
            empty: 'No schedules entered',
            hint: [powerCoverageNote(power) ?? 'every deal scheduled', rolledNote].filter(Boolean).join(', '),
          },
          {
            label: 'Pipeline value',
            value: value.amount > 0 ? formatValue(value.amount) : null,
            empty: 'Nothing priced',
            hint: [coverageNote(value) ?? 'every deal priced', rolledNote].filter(Boolean).join(', '),
          },
          {
            label: 'Weighted value',
            value: weighted > 0 ? formatValue(weighted) : null,
            empty: 'No win bands set',
            hint: 'value × win probability, over the deals carrying both',
            tone: 'info',
            // ⚠ INTERNAL, LIKE THE TWO COLUMNS IT SUMMARISES. A weighted figure
            // is our own read on whether we win; handing it to a counterparty
            // tells them what we think our odds are.
            internal: true,
          },
        ],
      },
      {
        kind: 'bars',
        title: 'Where the portfolio sits',
        description: 'Deals in each stage, with the capacity behind them.',
        bars: STAGE_ORDER.map((stage) => {
          const inStage = deals.filter((deal) => deal.stage === stage)
          const stagePower = portfolioPower(
            register.rollupSet.filter((h) => inStage.some((d) => d.id === h.id)),
            phasesOf
          )
          return {
            label: STAGE_LABELS[stage],
            value: inStage.length,
            display: `${inStage.length}`,
            tone: STAGE_TONE[stage],
            note: stagePower.megawatts > 0 ? formatMegawatts(stagePower.megawatts) : undefined,
          }
        }).filter((bar) => bar.value > 0),
      },
      {
        kind: 'table',
        title: 'Every deal',
        columns,
        groups,
        totals: true,
        coverage: [
          `${pricedCount} of ${deals.length} deals carry an estimated value`,
          `${power.withSchedule} of ${deals.length} carry a ramp-up schedule`,
          register.withheld > 0
            ? `${register.withheld} protected deal${register.withheld === 1 ? '' : 's'} withheld`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        empty: 'No deals in the pipeline.',
      },
      ...(pricedCount < deals.length
        ? [
            {
              kind: 'note' as const,
              title: 'What this report cannot tell you yet',
              body: [
                `The value and capacity columns are blank on most rows because the figures have not been entered, not because the deals are worth nothing.`,
                `${deals.length - pricedCount} of ${deals.length} deals have no estimated value and ${power.without} have no ramp-up schedule.`,
                `Totals above are over the deals that carry a figure, and say so — they are not portfolio totals.`,
              ].join(' '),
              tone: 'caution' as const,
              // Internal: a reader outside the company does not need to be told
              // which of our own fields we have not filled in. They get the
              // coverage line under the table, which is a fact about the
              // figures rather than a note about our housekeeping.
              internal: true,
            } satisfies NoteSection,
          ]
        : []),
    ],
  }
}

/** A deal's own phases, summed — the opportunity half, which has no hierarchy. */
function sumPhases(phases: readonly { megawatts: number | string | null }[]): number | null {
  let total = 0
  let seen = 0
  for (const phase of phases) {
    const mw = typeof phase.megawatts === 'number' ? phase.megawatts : Number(phase.megawatts)
    if (!Number.isFinite(mw)) continue
    total += mw
    seen += 1
  }
  return seen === 0 ? null : total
}
