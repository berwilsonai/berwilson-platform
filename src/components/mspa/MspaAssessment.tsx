import Link from 'next/link'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { formatMoney, formatValue } from '@/lib/utils/constants'
import {
  COOLING_LABELS,
  MW_BASIS_LABELS,
  SCOPE_FEE_BASE_LABELS,
  type Assessment,
  type Flag,
  type FlagSeverity,
} from '@/lib/mspa'

/**
 * The assessment, rendered in Part E's order.
 *
 * ⚠ BER WILSON'S NUMBER LEADS AND THE MODELLED ESTIMATE FOLLOWS, VISIBLY
 * SEPARATED. The fees are contractual and exact; the returns are scenarios. A
 * screen that puts them side by side at the same weight is the presentation
 * failure this layout exists to prevent, so the modelled half carries its own
 * header saying what it is.
 */

const FLAG_TONE: Record<FlagSeverity, string> = {
  blocker:
    'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900',
  question:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
  note: 'bg-muted text-muted-foreground ring-border',
}

const FLAG_LABEL: Record<FlagSeverity, string> = {
  blocker: 'Blocks a number',
  question: 'Ask',
  note: 'Note',
}

function Row({
  label,
  value,
  sub,
  strong = false,
}: {
  label: string
  value: string
  sub?: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2">
      <div className="min-w-0">
        <div className={strong ? 'text-sm font-medium' : 'text-sm'}>{label}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </div>
      <div className={`tnum shrink-0 ${strong ? 'text-sm font-semibold' : 'text-sm'}`}>{value}</div>
    </div>
  )
}

function FlagList({ flags }: { flags: readonly Flag[] }) {
  if (flags.length === 0) return null
  return (
    <Panel className="overflow-hidden">
      <PanelHeader label="Flags" count={flags.length} />
      <ul className="divide-y divide-border">
        {flags.map((f, i) => (
          <li key={`${f.code}-${i}`} className="px-4 py-3">
            <div className="flex items-start gap-2">
              <Chip tone={FLAG_TONE[f.severity]}>{FLAG_LABEL[f.severity]}</Chip>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{f.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.detail}</p>
                <p className="mt-1.5 text-xs leading-relaxed">
                  <span className="label-caps text-muted-foreground">To clear it </span>
                  {f.resolution}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export default function MspaAssessment({ assessment: a }: { assessment: Assessment }) {
  const blockers = a.flags.filter((f) => f.severity === 'blocker').length

  return (
    <div className="space-y-4">
      {/* ── Capacity, first, because the unit trap poisons everything below. */}
      <Panel className="overflow-hidden">
        <PanelHeader label="Capacity" />
        {a.capacity ? (
          <div className="divide-y divide-border">
            <Row
              label="IT load"
              value={`${a.capacity.itMw.toFixed(1)} MW`}
              sub={
                a.capacity.statedBasis === 'it'
                  ? 'As stated'
                  : `Derived at PUE ${a.capacity.pue.toFixed(2)}`
              }
              strong={a.capacity.statedBasis === 'it'}
            />
            <Row
              label="Utility load"
              value={`${a.capacity.utilityMw.toFixed(1)} MW`}
              sub={
                a.capacity.statedBasis === 'utility'
                  ? 'As stated'
                  : `Derived at PUE ${a.capacity.pue.toFixed(2)}`
              }
              strong={a.capacity.statedBasis === 'utility'}
            />
            <Row
              label="Cooling load"
              value={`${a.capacity.coolingMw.toFixed(1)} MW`}
              sub="Utility less IT — what the cooling electrical is priced on"
            />
            <div className="px-4 py-2 text-xs text-muted-foreground">
              Stated on the {MW_BASIS_LABELS[a.capacity.statedBasis].toLowerCase()} basis.
            </div>
          </div>
        ) : a.bothReadings ? (
          <div className="divide-y divide-border">
            <div className="bg-red-50 px-4 py-2.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              The basis is unconfirmed, so both readings are shown and neither is adopted.
            </div>
            <Row label="If the figure is IT load" value={`${a.bothReadings.asIt.toFixed(1)} MW utility`} />
            <Row label="If the figure is utility load" value={`${a.bothReadings.asUtility.toFixed(1)} MW IT`} />
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No capacity figure on the record, so nothing below can be computed.
          </p>
        )}
      </Panel>

      {/* ── Ber Wilson's number. Contractual, exact. */}
      <Panel className="overflow-hidden">
        <PanelHeader label="Ber Wilson fees — Schedule 1, computed exactly">
          {a.phases.some((p) => p.costsAreModelled) && (
            <Chip tone={FLAG_TONE.question}>On a modelled cost base</Chip>
          )}
        </PanelHeader>

        {a.phases.map((phase) => (
          <div key={phase.label} className="border-b border-border last:border-0">
            <div className="flex items-center justify-between gap-2 bg-muted/30 px-4 py-1.5">
              <span className="label-caps text-muted-foreground">{phase.label}</span>
              {phase.capacity && (
                <span className="tnum text-xs text-muted-foreground">
                  {phase.capacity.itMw.toFixed(1)} IT MW · {phase.capacity.utilityMw.toFixed(1)} utility MW
                </span>
              )}
            </div>
            <div className="divide-y divide-border">
              {phase.fees.scopes.map((s) => (
                <Row
                  key={s.scope}
                  label={`Scope ${s.scope} — ${s.label}`}
                  value={formatMoney(s.fee)}
                  sub={
                    s.flatRatePct != null
                      ? `${s.flatRatePct.toFixed(1)}% of ${formatValue(s.base)} · ${s.baseLabel}`
                      : `${s.tiers.map((t) => `${t.ratePct}% on ${formatValue(t.sliceBase)}`).join(' + ')} · ${SCOPE_FEE_BASE_LABELS[s.scope]}`
                  }
                />
              ))}
              {phase.fees.preconstructionFee > 0 && (
                <Row
                  label="Preconstruction"
                  value={formatMoney(phase.fees.preconstructionFee)}
                  sub={`0.5% of ${formatValue(phase.fees.preconstructionBase)} Cost of the Work for Scopes ${phase.fees.preconstructionScopes.join(', ')} — outside the cap`}
                />
              )}
              {phase.fees.utilityCoordinationFee > 0 && (
                <Row
                  label="Utility coordination"
                  value={formatMoney(phase.fees.utilityCoordinationFee)}
                  sub="1.5% of owner payments to the utility for utility-built work — outside TPC and outside the cap"
                />
              )}
              <Row
                label={`Total fees, ${phase.label.toLowerCase()}`}
                value={formatMoney(phase.fees.totalFees)}
                sub={
                  phase.fees.capAmount != null
                    ? `Scopes A–D ${phase.fees.effectiveScopePctOfTpc?.toFixed(2)}% of TPC against the 9.0% cap${phase.fees.capApplied ? ' — the cap was applied' : ''}`
                    : 'The 9.0% cap could not be tested: no Total Project Cost'
                }
                strong
              />
            </div>
            {phase.fees.notes.length > 0 && (
              <ul className="space-y-1 bg-muted/20 px-4 py-2">
                {phase.fees.notes.map((n, i) => (
                  <li key={i} className="text-xs leading-relaxed text-muted-foreground">{n}</li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {a.phases.length > 1 && (
          <div className="divide-y divide-border border-t-2 border-border">
            <Row label="All phases — Scope fees" value={formatMoney(a.totalScopeFees)} />
            <Row label="All phases — preconstruction" value={formatMoney(a.totalPreconstruction)} />
            <Row label="All phases — total fees" value={formatMoney(a.totalFees)} strong />
          </div>
        )}
      </Panel>

      {/* ── Role protection. Also contractual. */}
      <Panel className="overflow-hidden">
        <PanelHeader label="Role Protection Payment — if Ber Wilson is cut out" />
        {a.phases.map((phase) => {
          const p = phase.protection
          return (
            <div key={phase.label} className="border-b border-border last:border-0">
              <div className="flex items-center justify-between gap-2 bg-muted/30 px-4 py-1.5">
                <span className="label-caps text-muted-foreground">{phase.label}</span>
                <Chip tone={FLAG_TONE.note}>
                  Stage {p.stage} — {p.stageLabel} · {p.stagePct}%
                </Chip>
              </div>
              <div className="divide-y divide-border">
                {p.unearnedFees != null && (
                  <Row
                    label="Unearned Fees"
                    value={formatMoney(p.unearnedFees)}
                    sub="Schedule 1 Scope A–D fees, excluding preconstruction, less fees already earned"
                  />
                )}
                {p.usedFallback && p.fallbackPerMw != null && (
                  <Row
                    label="No reliable cost estimate"
                    value={formatMoney(p.stageAmount ?? 0)}
                    sub={`${formatMoney(p.fallbackPerMw)} per MW of affected Planned IT Capacity at Stage ${p.stage}`}
                  />
                )}
                <Row label="Power role protection" value={formatMoney(p.powerAmount)} sub="Blank in the PCA means no amount is implied" />
                {p.capAmount != null && (
                  <Row
                    label="Cap on the whole event"
                    value={formatMoney(p.capAmount)}
                    sub="3.0% of the first $1B of estimated TPC, 2.5% above"
                  />
                )}
                <Row
                  label="Payable"
                  value={p.payable != null ? formatMoney(p.payable) : '—'}
                  sub={
                    p.payable == null
                      ? 'Cannot be computed'
                      : p.capApplied
                        ? 'The cap governs'
                        : p.stageCondition
                  }
                  strong
                />
              </div>
              {(p.notes.length > 0 || p.blockers.length > 0) && (
                <ul className="space-y-1 bg-muted/20 px-4 py-2">
                  {p.blockers.map((n, i) => (
                    <li key={`b${i}`} className="text-xs leading-relaxed text-red-700 dark:text-red-300">{n}</li>
                  ))}
                  {p.notes.map((n, i) => (
                    <li key={`n${i}`} className="text-xs leading-relaxed text-muted-foreground">{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </Panel>

      {/* ── The modelled half, clearly marked as such. */}
      {a.sizing && (
        <Panel className="overflow-hidden">
          <PanelHeader label="TensorIQ project model — modelled estimate, not a forecast" />
          <div className="divide-y divide-border">
            <Row label="GPUs" value={`${a.sizing.gpuCount.toLocaleString()} × ${a.sizing.gpu.label}`} sub={`${a.sizing.servers.toLocaleString()} servers at 8 per server · ${COOLING_LABELS[a.capacity?.statedBasis === 'it' ? 'dlc' : 'dlc']}`} />
            <Row label="Hardware acquisition" value={formatValue(a.sizing.hardwareCost)} sub={`${formatMoney(a.sizing.hardwareCostPerGpu)} per GPU · ${formatValue(a.sizing.hardwareCostPerItMw)} per IT MW`} />
            <Row label="Floor area" value={`${Math.round(a.sizing.floorSqft).toLocaleString()} sqft`} />
            <div className="bg-muted/20 px-4 py-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                GPUs never enter a Schedule 1 fee base. Shown as project context only.
              </p>
            </div>
          </div>
          {a.sizing.caveats.length > 0 && (
            <ul className="space-y-1 border-t border-border bg-muted/20 px-4 py-2">
              {a.sizing.caveats.map((c, i) => (
                <li key={i} className="text-xs leading-relaxed text-muted-foreground">{c}</li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {a.returns && a.sensitivity && (
        <Panel className="overflow-hidden">
          <PanelHeader label="Returns — scenarios only" count={a.returns.length} />
          <div className="divide-y divide-border">
            {a.returns.map((r) => (
              <Row
                key={r.label}
                label={r.label}
                value={r.moic != null ? `${r.moic.toFixed(1)}×` : '—'}
                sub={`${formatMoney(r.contractRate)}/GPU-hr · EBITDA ${formatValue(r.stabilizedEbitda)} · DSCR ${r.dscrYearOne?.toFixed(2) ?? '—'}× · ${r.note}`}
              />
            ))}
          </div>
          <div className="border-t border-border">
            <div className="label-caps px-4 pt-2.5 text-muted-foreground">
              Sensitivity to the contract rate
            </div>
            <div className="divide-y divide-border">
              {a.sensitivity.map((s) => (
                <Row
                  key={s.cutPct}
                  label={s.cutPct === 0 ? 'As modelled' : `Rate down ${s.cutPct.toFixed(0)}%`}
                  value={s.moic != null ? `${s.moic.toFixed(1)}×` : '—'}
                  sub={`${formatMoney(s.rate)}/GPU-hr · EBITDA ${formatValue(s.ebitda)}`}
                />
              ))}
            </div>
          </div>
          <p className="border-t border-border bg-muted/20 px-4 py-2 text-xs leading-relaxed text-muted-foreground">
            Equity is a very small share of capex, so the whole return rests on the contract rate
            holding. These multiples are this platform&rsquo;s reconstruction and are not TensorIQ&rsquo;s
            published 14.9× / 72%. Read the direction, never the number.
          </p>
        </Panel>
      )}

      <FlagList flags={a.flags} />

      {a.assumptions.length > 0 && (
        <Panel className="overflow-hidden">
          <PanelHeader label="Assumptions used" count={a.assumptions.length} />
          <ul className="divide-y divide-border">
            {a.assumptions.map((x, i) => (
              <li key={i} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{x.field}</span>
                  <span className="tnum shrink-0 text-sm">{x.value}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{x.source}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {a.missing.length > 0 && (
        <Panel className="overflow-hidden">
          <PanelHeader label="Missing inputs" count={a.missing.length} />
          <ul className="divide-y divide-border">
            {a.missing.map((x, i) => (
              <li key={i} className="px-4 py-2.5">
                <div className="text-sm font-medium">{x.field}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">Blocks {x.blocks}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {blockers > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {blockers} {blockers === 1 ? 'flag blocks' : 'flags block'} a final number. Everything above
          is the best that can be said from what is on the record.{' '}
          <Link href="/mspa" className="underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            Back to the register
          </Link>
          .
        </p>
      )}
    </div>
  )
}
