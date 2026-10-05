/**
 * The revenue lines, grouped by the vehicle that earns them.
 *
 * ⚠ A LINE THAT IS NOT OURS SAYS SO ON ITS OWN ROW. On a campus deal most of
 * the gross belongs to partners, and a list that reads as a list of our
 * revenue is the single most misleading screen this feature could have.
 *
 * ⚠ AND A MISSING INPUT IS NAMED IN PLACE, not collected into a panel at the
 * bottom. "Needs a term" beside the line that needs one is actionable; the same
 * sentence three panels away is a chore.
 *
 * Server-renderable: pure divs.
 */

import { Panel } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { formatValue } from '@/lib/utils/constants'
import {
  REVENUE_LINE_LABELS,
  SPV_PURPOSE_LABELS,
  type DealEconomicsResult,
  type LineResult,
  type Spv,
} from '@/lib/economics'

function Headline({ line }: { line: LineResult }) {
  if (line.shape === 'recurring') {
    if (line.annualRevenue == null) {
      return <span className="text-xs text-muted-foreground">not priced yet</span>
    }
    return (
      <span className="tnum font-medium">
        {formatValue(line.annualRevenue)}
        <span className="text-xs font-normal text-muted-foreground"> a year</span>
        {line.contractValue != null ? (
          <span className="text-xs font-normal text-muted-foreground">
            {' · '}
            {formatValue(line.contractValue)} over term
          </span>
        ) : null}
      </span>
    )
  }
  if (line.oneTimeValue == null) {
    return <span className="text-xs text-muted-foreground">not priced yet</span>
  }
  return (
    <span className="tnum font-medium">
      {formatValue(line.oneTimeValue)}
      <span className="text-xs font-normal text-muted-foreground"> one-time</span>
    </span>
  )
}

function LineRow({ line }: { line: LineResult }) {
  const ours = line.isBerWilsonRevenue || line.isCaptureLine
  return (
    <li className="rounded-md bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium">{line.label}</span>
        <Headline line={line} />
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{REVENUE_LINE_LABELS[line.type]}</span>
        {line.facilityMw > 0 ? (
          <span>
            {' · '}
            draws {line.facilityMw.toLocaleString('en-US', { maximumFractionDigits: 1 })} MW
          </span>
        ) : null}
        {line.annualEnergyMwh != null ? (
          <span>
            {' · '}
            {Math.round(line.annualEnergyMwh).toLocaleString('en-US')} MWh a year
          </span>
        ) : null}
        {line.impliedAverageMw != null ? (
          <span>
            {' · '}
            implies {line.impliedAverageMw.toLocaleString('en-US', { maximumFractionDigits: 1 })} MW
            average load
          </span>
        ) : null}
        {!line.countsAsRevenue ? <span>{' · '}not revenue</span> : null}
        {line.isCarveOut ? <span>{' · '}carved out of another line</span> : null}
      </p>

      {!ours ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Revenue generated at the project. None of this is Ber Wilson&apos;s.
        </p>
      ) : null}

      {line.errors.length > 0 ? (
        <p className="mt-2 text-[11px] text-destructive">{line.errors.join('; ')}</p>
      ) : null}
      {line.missing.length > 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Needs: {Array.from(new Set(line.missing)).join('; ')}
        </p>
      ) : null}
    </li>
  )
}

interface LinesPanelProps {
  result: DealEconomicsResult
  spvs: Spv[]
}

export default function LinesPanel({ result, spvs }: LinesPanelProps) {
  if (result.lines.length === 0) {
    return (
      <Panel className="p-4 sm:p-5">
        <h2 className="label-caps text-muted-foreground">Revenue lines</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No lines yet. A line is one way this deal earns money: power sold, capacity leased, a
          build contract, steel supplied, land, a fee.
        </p>
      </Panel>
    )
  }

  const byId = new Map(spvs.map((s) => [s.id, s]))
  const groups = new Map<string, LineResult[]>()
  for (const line of result.lines) {
    const key = line.spvId ?? ''
    const list = groups.get(key) ?? []
    list.push(line)
    groups.set(key, list)
  }

  return (
    <Panel className="p-4 sm:p-5">
      <h2 className="label-caps text-muted-foreground">Revenue lines</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Grouped by the vehicle that earns them. Each line draws its megawatts from exactly one
        bucket, or from none at all.
      </p>

      <div className="mt-4 space-y-5">
        {Array.from(groups.entries()).map(([key, lines]) => {
          const spv = key === '' ? null : byId.get(key)
          return (
            <div key={key || 'parent'}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">
                  {spv ? spv.label : 'Ber Wilson Corporation'}
                </h3>
                {spv ? (
                  <Chip className="bg-muted text-muted-foreground">
                    {SPV_PURPOSE_LABELS[spv.purpose]}
                  </Chip>
                ) : null}
                <span className="text-[11px] text-muted-foreground">
                  {spv == null
                    ? 'wholly ours'
                    : spv.bwOwnershipPct == null
                      ? 'ownership split not set yet'
                      : `${spv.bwOwnershipPct}% ours`}
                </span>
              </div>
              <ul className="space-y-2">
                {lines.map((line) => (
                  <LineRow key={line.lineId} line={line} />
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
