/**
 * Capacity & Ramp-up — the megawatts, when they land, and on which deal.
 *
 * ⚠ THIS REPORT IS ENTIRELY EMPTY TODAY. `power_phases` held 0 rows on
 * 2026-10-31, the morning after the table shipped. That is not a reason to
 * leave it unbuilt — it is the reason to build it: filling the schedules is an
 * open item on Richard's own list, the figures are already sitting in his prose
 * (*"1,104 megawatts… in Phase 1"*), and a report that shows exactly what those
 * entries would buy is the clearest argument for spending the hour. The empty
 * state here is written to be that argument rather than a shrug.
 *
 * ⚠ EVERY FIGURE IS AN INCREMENT, NEVER A RUNNING TOTAL — 100 + 300 = 400, not
 * 300. `power.ts` carries the full reasoning; this report shows both readings
 * side by side (the phase's own megawatts and the cumulative after it) for the
 * same reason the editor does: the two are indistinguishable once typed, and a
 * reader who can see both cannot misread either.
 */

import {
  cumulativeRamp,
  formatMegawatts,
  nextPhase,
  phaseLookup,
  portfolioPower,
  powerCoverageNote,
  powerTotal,
  sortPhases,
} from '@/lib/records/power'
import { formatDate, STAGE_LABELS } from '@/lib/utils/constants'

import { registerCoverage, type DealRegister } from '../deals'
import type { BarsSection, ReportData, ReportRow, RowGroup, TableSection } from '../types'

export function buildCapacityReport(register: DealRegister): ReportData {
  const phasesOf = phaseLookup(register.phases)
  const power = portfolioPower(register.rollupSet, phasesOf)

  const scheduled = register.deals
    .map((deal) => ({ deal, phases: sortPhases([...phasesOf(deal.id)]) }))
    .filter((entry) => entry.phases.length > 0)

  /*
   * Capacity landing in each calendar year.
   *
   * ⚠ A PHASE WITH NO DATE IS NOT IN A YEAR AND IS NOT DROPPED EITHER. Capacity
   * is routinely known before the date it lands — that is why `target_date` is
   * nullable — so undated tranches get their own bucket at the end rather than
   * being assigned to this year or silently vanishing from a total that then
   * disagrees with the headline.
   */
  const byYear = new Map<string, number>()
  let undated = 0
  for (const { phases } of scheduled) {
    for (const phase of phases) {
      const mw = Number(phase.megawatts)
      if (!Number.isFinite(mw)) continue
      const year = phase.target_date?.slice(0, 4)
      if (!year) {
        undated += mw
        continue
      }
      byYear.set(year, (byYear.get(year) ?? 0) + mw)
    }
  }
  const years = [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b))

  // The next tranche due anywhere in the portfolio — the one date a reader
  // actually wants off this page.
  const upcoming = scheduled
    .map(({ deal, phases }) => ({ deal, phase: nextPhase(phases) }))
    .filter((entry): entry is { deal: (typeof scheduled)[number]['deal']; phase: NonNullable<ReturnType<typeof nextPhase>> } => entry.phase !== null)
    .sort((a, b) => (a.phase.target_date ?? '').localeCompare(b.phase.target_date ?? ''))

  const scheduleGroups: RowGroup[] = scheduled.map(({ deal, phases }) => {
    const steps = cumulativeRamp(phases)
    const total = powerTotal(phases)
    return {
      label: deal.name,
      rows: steps.map((step, i): ReportRow => ({
        id: `${deal.id}-${step.phase.phase_no}`,
        cells: {
          phase: step.phase.label ?? `Phase ${step.phase.phase_no}`,
          megawatts: step.megawatts,
          // ⚠ LABELLED "Cumulative" AND NOT "Total", because "total" beside an
          // increment column is exactly the ambiguity this whole module exists
          // to close. A reader scanning the last row of a deal sees the deal's
          // figure; a reader scanning the column sees it climb.
          cumulative: step.cumulative,
          date: step.phase.target_date ?? null,
          note: step.phase.note ?? null,
        },
        emphasis: i === steps.length - 1,
      })),
      summary: `${formatMegawatts(total.megawatts)} · ${total.definition.toLowerCase()}`,
    }
  })

  const byDealRows: ReportRow[] = scheduled.map(({ deal, phases }) => {
    const total = powerTotal(phases)
    return {
      id: deal.id,
      cells: {
        name: { value: deal.name, href: deal.href },
        stage: STAGE_LABELS[deal.stage],
        location: deal.location,
        phases: total.phases,
        capacity: total.megawatts,
        first: total.firstDate,
        last: total.lastDate,
      },
    }
  })

  return {
    title: 'Capacity & Ramp-up',
    subtitle: 'Megawatts by deal and by year — when capacity comes online',
    coverage: registerCoverage(register),
    withheld: register.withheld,
    sections: [
      {
        kind: 'stats',
        title: 'Capacity',
        stats: [
          {
            label: 'Total capacity',
            value: power.megawatts > 0 ? formatMegawatts(power.megawatts) : null,
            empty: 'No schedules entered',
            hint: 'the sum of every tranche on every deal, each deal counted once',
          },
          {
            label: 'Deals scheduled',
            /*
             * ⚠ THE DENOMINATOR IS THE ROLL-UP'S, NOT THE DEAL COUNT, AND THE
             * FIRST VERSION MIXED THE TWO IN ONE TILE: the value read "0 of 35"
             * over a hint reading "none of 34 scheduled". Same quantity, two
             * definitions, eight pixels apart — §12's opening rule, and the
             * reader's only possible conclusion is that one of them is wrong.
             * `power` counts leaves, because a program's capacity is its
             * sites'; so the tile counts leaves too, and the hint says where
             * the missing one went.
             */
            value: `${power.withSchedule} of ${power.withSchedule + power.without}`,
            hint:
              power.rolledUp > 0
                ? `${power.rolledUp} sub-project${power.rolledUp === 1 ? '' : 's'} counted inside ${power.rolledUp === 1 ? 'its parent' : 'their parents'}`
                : (powerCoverageNote(power) ?? 'every deal carries a schedule'),
            tone: power.withSchedule === 0 ? 'caution' : undefined,
          },
          {
            label: 'Next tranche',
            value: upcoming[0]
              ? `${formatMegawatts(Number(upcoming[0].phase.megawatts))} · ${formatDate(upcoming[0].phase.target_date)}`
              : null,
            empty: 'Nothing dated ahead',
            hint: upcoming[0]?.deal.name ?? 'no phase carries a future date',
          },
          {
            label: 'Fully ramped',
            value: years.length > 0 ? years[years.length - 1][0] : null,
            empty: 'No dates set',
            hint: 'the year the last dated tranche lands',
          },
        ],
      },
      ...(years.length > 0 || undated > 0
        ? [
            {
              kind: 'bars' as const,
              title: 'Capacity landing by year',
              description:
                'Each bar is the megawatts that come online that year — an increment, not a running total.',
              bars: [
                ...years.map(([year, mw]) => ({
                  label: year,
                  value: mw,
                  display: formatMegawatts(mw),
                  tone: 'info' as const,
                })),
                ...(undated > 0
                  ? [
                      {
                        label: 'No date yet',
                        value: undated,
                        display: formatMegawatts(undated),
                        tone: 'caution' as const,
                        note: 'capacity known, date not',
                      },
                    ]
                  : []),
              ],
            } satisfies BarsSection,
          ]
        : []),
      {
        kind: 'table',
        title: 'Capacity by deal',
        columns: [
          { key: 'name', label: 'Deal', format: 'text', width: 34 },
          { key: 'stage', label: 'Stage', format: 'text', width: 16 },
          { key: 'location', label: 'Location', format: 'text', width: 22 },
          { key: 'phases', label: 'Phases', format: 'number' },
          { key: 'capacity', label: 'Capacity', format: 'mw', total: true },
          { key: 'first', label: 'First online', format: 'date' },
          { key: 'last', label: 'Fully ramped', format: 'date' },
        ],
        rows: byDealRows,
        totals: byDealRows.length > 0,
        coverage: `${power.withSchedule} of ${power.withSchedule + power.without} deals carry a ramp-up schedule${
          power.rolledUp > 0 ? `, with ${power.rolledUp} sub-project(s) counted inside their parents` : ''
        }`,
        empty:
          'No deal carries a ramp-up schedule yet. Add one from a deal’s Overview tab — up to six tranches of megawatts, each with the date it comes online.',
      },
      ...(scheduleGroups.length > 0
        ? [
            {
              kind: 'table' as const,
              title: 'The schedule',
              description: 'Every tranche, in order, with the capacity online once it lands.',
              columns: [
                { key: 'phase', label: 'Phase', format: 'text' as const, width: 22 },
                { key: 'megawatts', label: 'This tranche', format: 'mw' as const },
                { key: 'cumulative', label: 'Cumulative', format: 'mw' as const },
                { key: 'date', label: 'Target', format: 'date' as const },
                { key: 'note', label: 'Note', format: 'text' as const, width: 40 },
              ],
              groups: scheduleGroups,
            } satisfies TableSection,
          ]
        : []),
    ],
  }
}
