/**
 * Every vehicle Ber Wilson is in, across every deal.
 *
 * ⚠ WHY THIS PAGE EXISTS. The Vehicles tab answers "what is THIS deal held in",
 * which is the right question from inside a project and the wrong one at fifty
 * of them. Nothing answered "every vehicle we are in", "how much capital is
 * committed across all of them", or "which cap tables do not add up" — so a
 * half-entered split surfaced only to whoever happened to open that one tab.
 * The warnings `splitWarnings` already produced had no portfolio-wide reader.
 *
 * ⚠ IT IS A READ. No vehicle is created or edited here: every control lives on
 * the deal that owns the vehicle, because that is where the context is. A
 * second place to edit a cap table is a second place for the two to disagree.
 *
 * Server component. Containment is applied inside `loadPortfolioVehicles`, not
 * here — a confidential project leaves every cross-portfolio surface, and the
 * COUNT of what was withheld is reported rather than silently omitted (§12).
 */

import Link from 'next/link'
import { Boxes, TriangleAlert } from 'lucide-react'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import EmptyState from '@/components/shared/EmptyState'
import { getViewer } from '@/lib/auth/viewer'
import { PROVENANCE_LABELS, PROVENANCE_TONES } from '@/lib/economics/provenance'
import { formatMoney, formatValue } from '@/lib/utils/constants'
import { TONE_BADGE } from '@/lib/utils/leads'
import {
  effectiveSpvStatus,
  participantTotals,
  resolveBwShare,
  splitWarnings,
  stillToPlace,
} from '@/lib/spvs/ownership'
import { loadPortfolioVehicles, type PortfolioVehicle } from '@/lib/spvs/portfolio'
import { SPV_PURPOSE_LABELS, SPV_ROLE_LABELS } from '@/lib/spvs/types'

export const metadata = { title: 'Vehicles — Ber Wilson Intelligence' }

/** Trailing zeros dropped: "35%", not "35.0000%". */
function pct(value: number): string {
  return `${Number(value.toFixed(4))}%`
}

/**
 * One portfolio figure.
 *
 * ⚠ A KPI TILE WITH NO VALUE IS NOT A KPI TILE (§12), so an absent total is
 * named in words at the weight of a label rather than printed as $0 — which
 * would be a statement about the portfolio that nobody made.
 */
function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string | null
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 elev-1">
      <p className="label-caps text-muted-foreground">{label}</p>
      {value == null ? (
        <p className="mt-0.5 text-sm text-muted-foreground">Nothing recorded</p>
      ) : (
        <p className="tnum mt-0.5 text-lg font-semibold">{value}</p>
      )}
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

export default async function VehiclesIndexPage() {
  const viewer = await getViewer()
  const { vehicles, hiddenDeals } = await loadPortfolioVehicles(viewer?.authUserId ?? null)

  // ⚠ EVERY TOTAL IS NULL UNTIL SOMETHING CONTRIBUTES TO IT. A sum with nothing
  // in it is null, not 0 (§12, 10-05): "$0 committed" across eleven vehicles
  // with real equity splits reads as computed rather than unfinished.
  let committed: number | null = null
  let funded: number | null = null
  let raiseTarget: number | null = null
  const add = (total: number | null, value: number | null) =>
    value == null ? total : (total ?? 0) + value

  const warningRows: { vehicle: PortfolioVehicle; warnings: string[] }[] = []
  let undetermined = 0

  for (const entry of vehicles) {
    const totals = participantTotals(entry.spv.participants)
    committed = add(committed, totals.committed)
    funded = add(funded, totals.funded)
    raiseTarget = add(raiseTarget, entry.spv.raiseTarget)

    const warnings = splitWarnings(entry.spv, entry.spv.participants)
    if (warnings.length > 0) warningRows.push({ vehicle: entry, warnings })
    if (resolveBwShare(entry.spv, entry.spv.participants).pct == null) undetermined += 1
  }

  const deals = new Set(vehicles.map((v) => v.deal.id)).size
  const stillToRaise = stillToPlace(raiseTarget, committed)

  // Grouped by deal: a portfolio index of vehicles is read deal by deal, and
  // `loadPortfolioVehicles` already sorted them that way.
  const byDeal: { deal: PortfolioVehicle['deal']; vehicles: PortfolioVehicle[] }[] = []
  for (const entry of vehicles) {
    const last = byDeal[byDeal.length - 1]
    if (last && last.deal.id === entry.deal.id) last.vehicles.push(entry)
    else byDeal.push({ deal: entry.deal, vehicles: [entry] })
  }

  return (
    <div className="space-y-6 py-6">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-900/40">
          <Boxes size={20} className="text-slate-500 dark:text-slate-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Vehicles</h1>
          <p className="text-sm text-muted-foreground">
            Every SPV across every deal, with who is in it and for how much. Read-only — a vehicle
            is edited on the deal that owns it, so there is only ever one place the cap table can
            change.
          </p>
        </div>
      </div>

      {vehicles.length === 0 ? (
        <>
          <EmptyState
            icon={Boxes}
            title="No vehicles on any deal yet"
            description="A vehicle is the SPV a deal is held in — Land, Energy, Data Center. Add them on a project or opportunity's Vehicles tab; until then every revenue line is earned by Ber Wilson Corporation and is wholly ours."
          />
          {hiddenDeals > 0 ? (
            <p className="text-xs text-muted-foreground">
              {hiddenDeals} protected {hiddenDeals === 1 ? 'deal is' : 'deals are'} not counted
              here.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Vehicles"
              value={String(vehicles.length)}
              sub={`across ${deals} ${deals === 1 ? 'deal' : 'deals'}`}
            />
            <Stat
              label="Capital committed"
              value={committed == null ? null : formatValue(committed)}
              sub={
                funded == null
                  ? 'nothing funded yet'
                  : `${formatValue(funded)} funded`
              }
            />
            <Stat
              label="Raise targets"
              value={raiseTarget == null ? null : formatValue(raiseTarget)}
              sub={
                stillToRaise == null
                  ? 'a target is a goal, never a rollup'
                  : stillToRaise > 0
                    ? `${formatValue(stillToRaise)} still to place`
                    : 'fully placed'
              }
            />
            <Stat
              label="Our share undetermined"
              value={String(undetermined)}
              sub={
                undetermined === 0
                  ? 'every vehicle says what is ours'
                  : 'held out of net totals, never guessed'
              }
            />
          </div>

          {hiddenDeals > 0 ? (
            <p className="text-xs text-muted-foreground">
              {hiddenDeals} protected {hiddenDeals === 1 ? 'deal is' : 'deals are'} not included in
              any figure above.
            </p>
          ) : null}

          {/*
            ⚠ THE WARNINGS COME FIRST, AND THEY ARE THE REASON THIS PAGE IS
            WORTH OPENING. `splitWarnings` has always produced these sentences;
            until now they were only visible to whoever opened that one deal's
            tab. They report and never block — a cap table is half-entered for
            most of a negotiation's life.
          */}
          {warningRows.length > 0 ? (
            <Panel>
              <PanelHeader label="Splits that do not add up" count={warningRows.length} />
              <ul className="divide-y divide-border">
                {warningRows.map(({ vehicle, warnings }) => (
                  <li key={vehicle.spv.id} className="px-4 py-3">
                    <Link
                      href={`${vehicle.deal.href}/vehicles`}
                      className="text-sm font-medium outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                    >
                      {vehicle.spv.label}
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        · {vehicle.deal.name}
                      </span>
                    </Link>
                    <ul className="mt-1 space-y-1">
                      {warnings.map((warning) => (
                        <li
                          key={warning}
                          className="flex items-start gap-2 text-xs text-muted-foreground"
                        >
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                          <span>{warning}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {byDeal.map(({ deal, vehicles: group }) => (
            <Panel key={deal.id}>
              <PanelHeader label={deal.kind === 'project' ? 'Project' : 'Opportunity'} count={group.length}>
                <Link
                  href={deal.href}
                  className="text-sm font-medium outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                >
                  {deal.name}
                </Link>
              </PanelHeader>
              <ul className="divide-y divide-border">
                {group.map((entry) => (
                  <VehicleRow key={entry.spv.id} entry={entry} />
                ))}
              </ul>
            </Panel>
          ))}
        </>
      )}
    </div>
  )
}

function VehicleRow({ entry }: { entry: PortfolioVehicle }) {
  const { spv, deal, pipeline } = entry
  const share = resolveBwShare(spv, spv.participants)
  const totals = participantTotals(spv.participants)
  // The vehicle is only as strong as its weakest participant: a vehicle marked
  // contracted whose third partner is a planning assumption is not contracted.
  const status = effectiveSpvStatus(spv, spv.participants)

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <Link
            href={`${deal.href}/vehicles`}
            className="text-sm font-medium outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
          >
            {spv.label}
          </Link>
          <p className="text-xs text-muted-foreground">
            {SPV_PURPOSE_LABELS[spv.purpose]}
            {spv.jurisdiction ? ` · ${spv.jurisdiction}` : ''}
            {spv.orgNodeName ? ` · in the chart as ${spv.orgNodeName}` : ' · not in the org chart'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status ? (
            <Chip className={TONE_BADGE[PROVENANCE_TONES[status]] ?? TONE_BADGE.slate}>
              {PROVENANCE_LABELS[status]}
            </Chip>
          ) : null}
          {share.pct == null ? (
            <span className="text-sm font-medium text-muted-foreground">Our share not set</span>
          ) : (
            <span className="tnum text-sm font-semibold">{pct(share.pct)} ours</span>
          )}
        </div>
      </div>

      {/* The ledger. Figures are omitted rather than shown as $0 when unset. */}
      {spv.participants.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>
            {spv.participants.length} {spv.participants.length === 1 ? 'holder' : 'holders'}
            {': '}
            {spv.participants
              .map((p) => `${p.holderName} (${SPV_ROLE_LABELS[p.role]})`)
              .join(', ')}
          </span>
          {totals.committed != null ? (
            <span>
              Committed{' '}
              <span className="tnum font-semibold text-foreground">
                {formatMoney(totals.committed)}
              </span>
            </span>
          ) : null}
          {totals.funded != null ? (
            <span>
              Funded{' '}
              <span className="tnum font-semibold text-foreground">
                {formatMoney(totals.funded)}
              </span>
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">
          No participants recorded, so our share is{' '}
          {spv.bwOwnershipPct != null ? 'the figure typed on the vehicle' : 'undetermined'}.
        </p>
      )}

      {/*
        ⚠ NAMED APART FROM THE LEDGER ABOVE AND NEVER SUMMED WITH IT. The same
        investor can be in the raise pipeline and on the cap table at once, so a
        combined "committed" would be larger than either truth.
      */}
      {pipeline.investorCount > 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          In the raise pipeline: {pipeline.investorCount}{' '}
          {pipeline.investorCount === 1 ? 'investor' : 'investors'}
          {pipeline.committed != null ? `, ${formatValue(pipeline.committed)} signed` : ''}
          {pipeline.onCapTable < pipeline.investorCount
            ? ` · ${pipeline.investorCount - pipeline.onCapTable} not yet on the cap table`
            : ''}
        </p>
      ) : null}
    </li>
  )
}
