import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/utils/constants'
import type { SteelDealService } from '@/lib/supabase/types'
import {
  STEEL_SERVICE_LABELS,
  STEEL_SERVICE_ORDER,
  isSteelServiceType,
  serviceMargin,
  serviceCommission,
  referralFeeAmount,
  referralFeeType,
  REFERRAL_FEE_LABELS,
  dealFinancials,
} from '@/lib/utils/steel'

interface Props {
  services: SteelDealService[]
  referralType: string
  referralValue: number | null
  referralPaid: boolean
  salespersonName: string | null
  referrerName: string | null
  squareFeet: number | null
}

function money(v: number | null): string {
  return v == null ? '—' : formatValue(v)
}

/** e.g. "$1.10 / SF" */
function perSqft(commission: number, sqft: number | null): string | null {
  if (!sqft || sqft <= 0) return null
  return `$${(commission / sqft).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / SF`
}

/** Read-only paid/owed pill. Marking paid happens on /steel/commissions. */
function StatusPill({ paid }: { paid: boolean }) {
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

export default function SteelCommissionsPanel({
  services,
  referralType,
  referralValue,
  referralPaid,
  salespersonName,
  referrerName,
  squareFeet,
}: Props) {
  const rows = [...services].sort(
    (a, b) =>
      (isSteelServiceType(a.service_type) ? STEEL_SERVICE_ORDER[a.service_type] : 9) -
      (isSteelServiceType(b.service_type) ? STEEL_SERVICE_ORDER[b.service_type] : 9)
  )

  const fin = dealFinancials(rows, referralType, referralValue)
  const rType = referralFeeType(referralType)
  const referralAmount = referralFeeAmount(referralType, referralValue, fin.margin)
  const label = (t: string) => (isSteelServiceType(t) ? STEEL_SERVICE_LABELS[t] : t)

  return (
    <section className="rounded-lg border border-border bg-card p-4 elev-1">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="label-caps text-muted-foreground">Margin &amp; Commissions</h2>
        <Link href="/steel/commissions" className="text-xs text-primary hover:underline">
          Payouts →
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
              <th className="font-medium pb-2 pr-3">Service</th>
              <th className="font-medium pb-2 px-3 text-right">Price</th>
              <th className="font-medium pb-2 px-3 text-right">Cost</th>
              <th className="font-medium pb-2 px-3 text-right">Margin</th>
              <th className="font-medium pb-2 px-3 text-right">Comm %</th>
              <th className="font-medium pb-2 px-3 text-right">Commission</th>
              <th className="font-medium pb-2 pl-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-muted-foreground text-center text-xs">
                  No services entered yet — add price &amp; cost on the deal to track margin.
                </td>
              </tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="py-2 pr-3 font-medium">{label(s.service_type)}</td>
                <td className="py-2 px-3 text-right">{money(s.price)}</td>
                <td className="py-2 px-3 text-right">{money(s.cost)}</td>
                <td className="py-2 px-3 text-right">{formatValue(serviceMargin(s))}</td>
                <td className="py-2 px-3 text-right">{s.commission_pct != null ? `${s.commission_pct}%` : '—'}</td>
                <td className="py-2 px-3 text-right">{formatValue(serviceCommission(s))}</td>
                <td className="py-2 pl-3 text-right">
                  {serviceCommission(s) !== 0 ? <StatusPill paid={s.commission_paid} /> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold tnum">
              <td className="py-2 pr-3">Total</td>
              <td className="py-2 px-3 text-right">{formatValue(fin.revenue)}</td>
              <td className="py-2 px-3 text-right">{formatValue(fin.cost)}</td>
              <td className="py-2 px-3 text-right">{formatValue(fin.margin)}</td>
              <td className="py-2 px-3" />
              <td className="py-2 px-3 text-right">{formatValue(fin.salespersonCommission)}</td>
              <td className="py-2 pl-3" />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Referral fee */}
      {rType !== 'none' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2 text-sm">
          <div className="min-w-0">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Referral fee</span>
            <p>
              <span className="font-medium tnum">{formatValue(referralAmount)}</span>{' '}
              <span className="text-muted-foreground">
                to {referrerName ?? 'referrer'} · {REFERRAL_FEE_LABELS[rType]}
                {rType === 'percent' && referralValue != null ? ` (${referralValue}% of margin)` : ''}
              </span>
            </p>
          </div>
          {referralAmount > 0 && <StatusPill paid={referralPaid} />}
        </div>
      )}

      {/* Summary */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Summary label="Total Margin" value={formatValue(fin.margin)} />
        <Summary
          label="Salesperson"
          value={formatValue(fin.salespersonCommission)}
          sub={
            [salespersonName ?? 'Unassigned', perSqft(fin.salespersonCommission, squareFeet)]
              .filter(Boolean)
              .join(' · ')
          }
        />
        <Summary label="Referral" value={formatValue(fin.referralFee)} sub={referrerName ?? '—'} />
        <Summary label="Net after comm." value={formatValue(fin.net)} strong />
      </div>
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
