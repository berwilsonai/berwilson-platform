import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/utils/constants'
import {
  referralFeeType,
  REFERRAL_FEE_LABELS,
  steelSizeTier,
  SIZE_TIER_LABELS,
  type DealFinancials,
} from '@/lib/utils/steel'

export interface CommissionPanelProps {
  fin: DealFinancials
  squareFeet: number | null
  salespersonName: string | null
  /** The marketing / referral source (a contact), when set. */
  referralSourceName: string | null
  referralType: string
  referralValue: number | null
  /** Deal's cash is collected → commissions are real payables (vs projected). */
  payable: boolean
  /** Per-payout paid state (deal-level). */
  salesPaid: boolean
  installPaid: boolean
  referralPaid: boolean
  salesAccelerated: boolean
  /**
   * 'full' = management view (all payouts + margin). 'self' = one person's own
   * cut — the roles they actually hold on THIS deal, set by the two flags below.
   */
  scope: 'full' | 'self'
  /** 'self' scope only: the viewer is the salesperson (sales + install fee). */
  viewerIsSalesperson?: boolean
  /** 'self' scope only: the viewer is the marketing / referral source. */
  viewerIsReferralSource?: boolean
}

type PayoutState = 'unset' | 'projected' | 'owed' | 'paid'

function StatusPill({ state }: { state: PayoutState }) {
  const tone: Record<PayoutState, string> = {
    unset: 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-400/10 dark:text-slate-400 dark:ring-slate-400/20',
    projected: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
    owed: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
    paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  }
  const label: Record<PayoutState, string> = {
    unset: 'Not set',
    projected: 'Projected',
    owed: 'Owed',
    paid: 'Paid',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        tone[state]
      )}
    >
      {label[state]}
    </span>
  )
}

function payoutState(amount: number, payable: boolean, paid: boolean): PayoutState {
  if (amount <= 0) return 'unset'
  if (!payable) return 'projected'
  return paid ? 'paid' : 'owed'
}

interface PayoutRow {
  key: string
  label: string
  who: string
  detail: string
  amount: number
  state: PayoutState
}

function PayoutTable({ rows }: { rows: PayoutRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-3 text-center text-xs text-muted-foreground">
        No commissions on this deal yet — set prices and a salesperson.
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
            <th className="font-medium pb-2 pr-3">Payout</th>
            <th className="font-medium pb-2 px-3">Who</th>
            <th className="font-medium pb-2 px-3 text-right">Amount</th>
            <th className="font-medium pb-2 pl-3 text-right">Status</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <td className="py-2 pr-3">
                <span className={cn('font-medium', r.state === 'unset' && 'text-muted-foreground')}>{r.label}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">{r.detail}</span>
              </td>
              <td className="py-2 px-3 text-muted-foreground">{r.who}</td>
              <td className={cn('py-2 px-3 text-right', r.state === 'unset' && 'text-muted-foreground')}>
                {r.amount > 0 ? formatValue(r.amount) : '—'}
              </td>
              <td className="py-2 pl-3 text-right">
                <StatusPill state={r.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SteelCommissionsPanel(props: CommissionPanelProps) {
  const {
    fin,
    squareFeet,
    salespersonName,
    referralSourceName,
    referralType,
    referralValue,
    payable,
    salesPaid,
    installPaid,
    referralPaid,
    salesAccelerated,
    scope,
    viewerIsSalesperson = false,
    viewerIsReferralSource = false,
  } = props

  const tier = SIZE_TIER_LABELS[steelSizeTier(squareFeet)]
  const rType = referralFeeType(referralType)
  const salesDetail = `${fin.salesRate}% of commissionable margin${salesAccelerated ? ' · +1 accelerator' : ''}`
  const referralDetail =
    rType === 'none'
      ? 'No fee agreed yet'
      : REFERRAL_FEE_LABELS[rType] + (rType === 'percent' && referralValue != null ? ` (${referralValue}% of margin)` : '')

  // Which roles this view is accountable for. Management sees every payout on
  // the deal; a person in 'self' scope sees only the roles they hold — a rep
  // who referred a deal someone else sold still has a marketing commission.
  const showSales = scope === 'full' || viewerIsSalesperson
  const showReferral = scope === 'full' || viewerIsReferralSource

  // Sales and marketing are BOTH always rendered when in scope, even at zero.
  // Hiding an unconfigured payout makes "nobody is owed a marketing commission"
  // look identical to "this deal doesn't have marketing commissions" — which is
  // how a referral fee gets forgotten rather than decided.
  const rows: PayoutRow[] = []
  if (showSales) {
    rows.push({
      key: 'sales',
      label: 'Sales commission',
      who: salespersonName ?? 'No salesperson set',
      detail: salesDetail,
      amount: fin.salesCommission,
      state: payoutState(fin.salesCommission, payable, salesPaid),
    })
    if (fin.installFee > 0) {
      rows.push({
        key: 'install',
        label: 'Installation fee',
        who: salespersonName ?? 'No salesperson set',
        detail: 'Flat per install job',
        amount: fin.installFee,
        state: payoutState(fin.installFee, payable, installPaid),
      })
    }
  }
  if (showReferral) {
    rows.push({
      key: 'referral',
      label: 'Marketing / referral fee',
      who: referralSourceName ?? 'No marketing source set',
      detail: referralDetail,
      amount: fin.referralFee,
      state: payoutState(fin.referralFee, payable, referralPaid),
    })
  }

  // In 'self' scope, the total is only the roles this person holds.
  const selfTotal =
    (viewerIsSalesperson ? fin.salesCommission + fin.installFee : 0) +
    (viewerIsReferralSource ? fin.referralFee : 0)

  return (
    <section className="rounded-lg border border-border bg-card p-4 elev-1">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="label-caps text-muted-foreground">
          {scope === 'self' ? 'Your Commission' : 'Margin & Commissions'}
        </h2>
        {scope === 'full' && (
          <Link href="/steel/commissions" className="text-xs text-primary hover:underline">
            Payouts →
          </Link>
        )}
      </div>

      {/* Margin band — management sees the full picture; a rep sees the
          commissionable margin their rate is applied to. */}
      {scope === 'full' ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4 text-sm">
          <Summary label="Revenue" value={formatValue(fin.revenue)} />
          <Summary label="Cost" value={formatValue(fin.cost)} />
          <Summary label="Total Margin" value={formatValue(fin.margin)} />
          <Summary label="Commissionable" value={formatValue(fin.commissionableMargin)} sub="excl. install" />
          <Summary label="Install Margin" value={formatValue(fin.installMargin)} sub="not commissioned" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <Summary label="Commissionable Margin" value={formatValue(fin.commissionableMargin)} sub={`Size tier: ${tier}`} />
          <Summary label="Your Commission" value={formatValue(selfTotal)} strong />
        </div>
      )}

      <PayoutTable rows={rows} />

      {scope === 'full' && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Summary
            label="Sales commission"
            value={formatValue(fin.salesCommission)}
            sub={`${fin.salesRate}% · ${salespersonName ?? 'unassigned'}`}
          />
          <Summary
            label="Marketing / referral"
            value={fin.referralFee > 0 ? formatValue(fin.referralFee) : '—'}
            sub={referralSourceName ?? 'no source set'}
          />
          <Summary label="Total Payout" value={formatValue(fin.totalPayout)} />
          <Summary label="Net after comm." value={formatValue(fin.net)} strong />
        </div>
      )}

      {scope === 'full' && !referralSourceName && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          No marketing / referral source on this deal. Set one (and its fee) under{' '}
          <span className="font-medium text-foreground">Marketing / Referral Source</span> when you edit the deal.
        </p>
      )}
      {scope === 'full' && referralSourceName && rType === 'none' && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {referralSourceName} is credited as the marketing source but no referral fee is agreed — set a flat amount or
          a % of margin when you edit the deal.
        </p>
      )}

      {!payable && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Commissions are <span className="font-medium">projected</span> until the deal&apos;s cash is collected (Paid stage).
        </p>
      )}
    </section>
  )
}

function Summary({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-md border border-border px-3 py-2', strong && 'bg-primary/5 border-primary/30')}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tnum mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground truncate">{sub}</p>}
    </div>
  )
}
