/**
 * The capacity allocation ledger: every megawatt from source to use.
 *
 * ⚠ THE OVERAGE IS THE HEADLINE WHEN THERE IS ONE, not a footnote. Allocating
 * more capacity than the plant has means the same megawatts have been sold
 * twice, so it reads at the top, in words, with the figure.
 *
 * ⚠ AND RED IS RESERVED. When every row is red, red has stopped signifying
 * (CLAUDE.md §12, 09-26): only a genuine overage gets the alarm colour. High
 * utilization is a fact, not an alarm, so it is stated plainly.
 *
 * Server-renderable: pure divs.
 */

import { Panel } from '@/components/ui/card'
import { formatPercent } from '@/lib/utils/constants'
import { CAPACITY_SOURCE_LABELS, type DealEconomicsResult } from '@/lib/economics'

function mw(value: number | null | undefined, opts: { empty?: string } = {}): string {
  if (value == null || !Number.isFinite(value)) return opts.empty ?? 'not set'
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} MW`
}

export default function LedgerPanel({ result }: { result: DealEconomicsResult }) {
  const { ledger } = result
  const allocated = ledger.buckets.filter((b) => b.allocatedMw > 0)

  return (
    <Panel className="p-4 sm:p-5">
      <h2 className="label-caps text-muted-foreground">Capacity ledger</h2>

      {ledger.overageMw != null ? (
        <div className="mt-3 rounded-md bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">
            {mw(ledger.overageMw)} more capacity is committed than this deal has
          </p>
          <p className="mt-1 text-muted-foreground">
            {mw(ledger.allocatedMw)} allocated against {mw(ledger.firmMw)} firm. Nothing is
            prorated and no deal size is published until the allocations fit, because the same
            megawatts cannot be sold twice.
          </p>
        </div>
      ) : null}

      {ledger.noBuckets && ledger.allocatedMw > 0 ? (
        <p className="mt-3 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          This model has no allocation buckets, so {mw(ledger.allocatedMw)} of load belongs to
          nobody. Add the buckets before treating it as a deal model.
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="label-caps text-muted-foreground">Nameplate</dt>
          <dd className="tnum mt-0.5 font-medium">{mw(ledger.nameplateMw)}</dd>
        </div>
        <div>
          <dt className="label-caps text-muted-foreground">Firm</dt>
          <dd className="tnum mt-0.5 font-medium">{mw(ledger.firmMw)}</dd>
          <dd className="text-[11px] text-muted-foreground">after redundancy and availability</dd>
        </div>
        <div>
          <dt className="label-caps text-muted-foreground">Allocated</dt>
          <dd className="tnum mt-0.5 font-medium">{mw(ledger.allocatedMw, { empty: 'none' })}</dd>
          <dd className="text-[11px] text-muted-foreground">average load, not peak</dd>
        </div>
        <div>
          <dt className="label-caps text-muted-foreground">Utilization</dt>
          <dd className="tnum mt-0.5 font-medium">
            {ledger.utilizationPct == null ? (
              <span className="text-xs font-normal text-muted-foreground">
                needs a firm figure
              </span>
            ) : (
              formatPercent(ledger.utilizationPct)
            )}
          </dd>
          {ledger.surplusMw != null && ledger.surplusMw > 0 ? (
            <dd className="text-[11px] text-muted-foreground">
              {mw(ledger.surplusMw)} uncommitted
            </dd>
          ) : null}
        </div>
      </dl>

      {ledger.sources.length > 0 ? (
        <div className="mt-5">
          <h3 className="label-caps text-muted-foreground">Where the megawatts come from</h3>
          <ul className="mt-2 space-y-2">
            {ledger.sources.map((s) => (
              <li key={s.sourceId} className="rounded-md bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{s.label}</span>
                  <span className="tnum">{mw(s.firmMw)} firm</span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {CAPACITY_SOURCE_LABELS[s.kind]}
                  {s.basis === 'block_design' && s.blocksInService != null
                    ? ` · ${s.blocksInService} blocks in service`
                    : ''}
                  {s.nameplateMw != null ? ` · ${mw(s.nameplateMw)} nameplate` : ''}
                </p>
                {s.statedNetMismatch ? (
                  <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                    Stated as {mw(s.statedNetMismatch.stated)} net, works out to{' '}
                    {mw(s.statedNetMismatch.derived)} from the block design. Both are kept so the
                    disagreement is visible rather than settled silently.
                  </p>
                ) : null}
                {s.missing.length > 0 ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Needs: {s.missing.join('; ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {allocated.length > 0 ? (
        <div className="mt-5">
          <h3 className="label-caps text-muted-foreground">What they are allocated to</h3>
          <ul className="mt-2 space-y-1.5">
            {allocated.map((b) => (
              <li key={b.bucketId} className="text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>{b.label}</span>
                  <span className="tnum text-muted-foreground">{mw(b.allocatedMw)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {b.lines.map((l) => l.lineLabel).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  )
}
