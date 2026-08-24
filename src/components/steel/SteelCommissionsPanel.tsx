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
   * 'full' = management view (all payouts + margin). 'self' = the salesperson's
   * own cut (sales commission + install fee only — the referral fee is paid to a
   * separate contact, not the rep).
   */
  scope: 'full' | 'self'
}

function StatusPill({ paid, payable }: { paid: boolean; payable: boolean }) {
  if (!payable) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25">
        Projected
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        paid
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30'
          : 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30'
      )}
    >
      {paid ? 'Paid' : 'Owed'}
    </span>
  )
}

interface PayoutRow {
  label: string
  who: string
  detail: string
  amount: number
  paid: boolean
}

function PayoutTable({ rows, payable }: { rows: PayoutRow[]; payable: boolean }) {
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
            <tr key={r.label} className="border-t border-border">
              <td className="py-2 pr-3">
                <span className="font-medium">{r.label}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">{r.detail}</span>
              </td>
              <td className="py-2 px-3 text-muted-foreground">{r.who}</td>
              <td className="py-2 px-3 text-right">{formatValue(r.amount)}</td>
              <td className="py-2 pl-3 text-right">
                <StatusPill paid={r.paid} payable={payable} />
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
  } = props

  const tier = SIZE_TIER_LABELS[steelSizeTier(squareFeet)]
  const rType = referralFeeType(referralType)
  const salesDetail = `${fin.salesRate}% of commissionable margin${salesAccelerated ? ' · +1 accelerator' : ''}`

  // In 'self' scope the viewer is the salesperson → sales + install only.
  // The referral fee (to a separate contact) is management-only.
  const rows: PayoutRow[] = []
  if (fin.salesCommission !== 0) {
    rows.push({
      label: 'Sales commission',
      who: salespersonName ?? 'Unassigned',
      detail: salesDetail,
      amount: fin.salesCommission,
      paid: salesPaid,
    })
  }
  if (fin.installFee > 0) {
    rows.push({
      label: 'Installation fee',
      who: salespersonName ?? 'Unassigned',
      detail: 'Flat per install job',
      amount: fin.installFee,
      paid: installPaid,
    })
  }
  if (scope === 'full' && fin.referralFee > 0) {
    rows.push({
      label: 'Referral fee',
      who: referralSourceName ?? 'Referral source',
      detail:
        REFERRAL_FEE_LABELS[rType] + (rType === 'percent' && referralValue != null ? ` (${referralValue}% of margin)` : ''),
      amount: fin.referralFee,
      paid: referralPaid,
    })
  }

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
          <Summary
            label="Your Commission"
            value={formatValue(fin.salesCommission + (fin.installFee > 0 ? fin.installFee : 0))}
            strong
          />
        </div>
      )}

      <PayoutTable rows={rows} payable={payable} />

      {scope === 'full' && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Summary label="Total Payout" value={formatValue(fin.totalPayout)} />
          <Summary label="Net after comm." value={formatValue(fin.net)} strong />
          <Summary label="Sales rate" value={`${fin.salesRate}%`} sub={tier} />
          <Summary label="Referral fee" value={formatValue(fin.referralFee)} sub={referralSourceName ?? '—'} />
        </div>
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
