/**
 * The headline: how big is this deal, and how much of it is ours.
 *
 * ⚠ ONE QUANTITY PER ROW, ONE DEFINITION PER COLUMN, AND NOTHING CALLED JUST
 * "VALUE". Six quantities that must never be added together run down the side;
 * the three tiers that must never stand in for one another run across the top.
 * A $500M project where Ber Wilson earns a $20M fee reads as $20M in the right
 * hand column and $500M in the left, on the same line, at the same time.
 *
 * ⚠ AND A NULL IS NOT RENDERED AS A VALUE. A quantity no line contributed to
 * shows "not set" in muted small text, never $0 and never a bare em dash at the
 * figure's own weight, which reads as a failed render (CLAUDE.md §12, 09-26).
 * A row where all three tiers are empty is omitted entirely.
 *
 * Server-renderable: pure divs, no state, no client hooks.
 */

import { Panel } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { formatPercent, formatValue } from '@/lib/utils/constants'
import {
  PROVENANCE_LABELS,
  PROVENANCE_TONES,
  type DealEconomicsResult,
  type DealSize,
} from '@/lib/economics'

/** Tone names resolved against a palette declared literally here, so Tailwind sees every class. */
const TONE_CLASS: Record<string, string> = {
  slate: 'bg-muted text-muted-foreground',
  sky: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}

interface Row {
  label: string
  /** What the figure IS, shown under the label so nobody has to guess. */
  hint: string
  pick: (size: DealSize) => number | null
}

const ROWS: Row[] = [
  {
    label: 'Annual recurring',
    hint: 'at stabilization, before escalation',
    pick: (s) => s.annualRecurringRevenue,
  },
  {
    label: 'Contract value',
    hint: 'recurring revenue summed over each term, escalation included',
    pick: (s) => s.contractValue,
  },
  { label: 'One-time revenue', hint: 'builds, equipment, land sales', pick: (s) => s.oneTimeRevenue },
  { label: 'Tax credits', hint: 'money, and not revenue', pick: (s) => s.taxCredits },
  {
    label: 'Total project value',
    hint: 'what it costs to build, or the build contract',
    pick: (s) => s.totalProjectValue,
  },
  {
    label: 'Stabilized asset value',
    hint: 'NOI capitalized at the deal cap rate',
    pick: (s) => s.stabilizedAssetValue,
  },
]

function Figure({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-xs text-muted-foreground">not set</span>
  }
  return <span className="tnum font-medium">{formatValue(value)}</span>
}

export default function DealSizePanel({ result }: { result: DealEconomicsResult }) {
  const { grossGenerated, berWilsonGross, berWilsonNet } = result.tiers
  const tiers: { key: string; label: string; hint: string; size: DealSize }[] = [
    {
      key: 'gross',
      label: 'Revenue generated',
      hint: 'every party on the deal',
      size: grossGenerated,
    },
    {
      key: 'bwgross',
      label: 'Ber Wilson gross',
      hint: 'lines tagged ours, plus every fee',
      size: berWilsonGross,
    },
    {
      key: 'bwnet',
      label: 'Ber Wilson net',
      hint: 'times our share of each vehicle',
      size: berWilsonNet,
    },
  ]

  // A row with nothing in any tier is omitted rather than printed as three
  // blanks. Six empty rows is how a model that has barely been started reads as
  // a deal worth nothing.
  const rows = ROWS.filter((row) => tiers.some((t) => row.pick(t.size) != null))

  return (
    <Panel className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="label-caps text-muted-foreground">Deal size</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Six quantities that are not interchangeable, in three tiers that are not either.
          </p>
        </div>
        {result.status ? (
          <Chip
            className={TONE_CLASS[PROVENANCE_TONES[result.status]] ?? TONE_CLASS.slate}
          >
            {PROVENANCE_LABELS[result.status]}
          </Chip>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing has been priced yet. Add a revenue line to see a deal size.
        </p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left font-normal sm:px-0" />
                {tiers.map((t) => (
                  <th key={t.key} className="px-3 py-2 text-right align-bottom">
                    <span className="label-caps block text-foreground">{t.label}</span>
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {t.hint}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 sm:px-0">
                    <span className="block">{row.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{row.hint}</span>
                  </td>
                  {tiers.map((t) => (
                    <td key={t.key} className="px-3 py-2.5 text-right">
                      <Figure value={row.pick(t.size)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!result.tiers.ownershipComplete ? (
        <div className="mt-4 rounded-md bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Some of what is ours is not yet quantified</p>
          <p className="mt-1 text-muted-foreground">
            {result.tiers.spvsMissingOwnership.map((s) => s.label).join(', ')} has no Ber Wilson
            ownership split set, so{' '}
            {result.tiers.undetermined.annualRecurringRevenue != null ? (
              <>
                <span className="tnum">
                  {formatValue(result.tiers.undetermined.annualRecurringRevenue)}
                </span>{' '}
                a year
              </>
            ) : null}
            {result.tiers.undetermined.annualRecurringRevenue != null &&
            result.tiers.undetermined.oneTimeRevenue != null
              ? ' and '
              : null}
            {result.tiers.undetermined.oneTimeRevenue != null ? (
              <>
                <span className="tnum">
                  {formatValue(result.tiers.undetermined.oneTimeRevenue)}
                </span>{' '}
                one-time
              </>
            ) : null}{' '}
            is held out of the net column rather than counted as all ours.
          </p>
        </div>
      ) : null}

      <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
        {result.tiers.capturePctOfGross != null ? (
          <div>
            <dt className="label-caps text-muted-foreground">Our share of the deal</dt>
            <dd className="tnum mt-0.5 font-medium">
              {formatPercent(result.tiers.capturePctOfGross)}
            </dd>
            <dd className="text-[11px] text-muted-foreground">
              our contract, one-time and credits against the same three gross
            </dd>
          </div>
        ) : null}
        {result.tiers.captureOneTimePctOfProjectValue != null ? (
          <div>
            <dt className="label-caps text-muted-foreground">Fee on build</dt>
            <dd className="tnum mt-0.5 font-medium">
              {formatPercent(result.tiers.captureOneTimePctOfProjectValue)}
            </dd>
            <dd className="text-[11px] text-muted-foreground">
              our one-time revenue over total project value
            </dd>
          </div>
        ) : null}
        {result.tiers.perMwCapture.contractValue != null ? (
          <div>
            <dt className="label-caps text-muted-foreground">Capture per MW</dt>
            <dd className="tnum mt-0.5 font-medium">
              {formatValue(result.tiers.perMwCapture.contractValue)}
            </dd>
            <dd className="text-[11px] text-muted-foreground">
              contract value per MW of firm capacity
            </dd>
          </div>
        ) : null}
      </dl>
    </Panel>
  )
}
