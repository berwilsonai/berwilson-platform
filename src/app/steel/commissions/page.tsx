import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, canSeeSteelFinancials } from '@/lib/auth/viewer'
import { formatValue } from '@/lib/utils/constants'
import {
  dealFinancials,
  serviceMargin,
  serviceCommission,
  isSteelServiceType,
  isLostStage,
  STEEL_SERVICE_TYPES,
  STEEL_SERVICE_LABELS,
} from '@/lib/utils/steel'
import SteelPayoutList, { type PayoutItem } from '@/components/steel/SteelPayoutList'

export const metadata = { title: 'Steel Commissions — Ber Wilson Intelligence' }

interface Agg {
  owed: number
  paid: number
}
const emptyAgg = (): Agg => ({ owed: 0, paid: 0 })
const n = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? v : 0)

export default async function SteelCommissionsPage() {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) redirect('/steel')
  // Confidential — steel_sales can reach /steel but not this report.
  if (!canSeeSteelFinancials(viewer)) redirect('/steel')

  const supabase = createAdminClient()
  const [{ data: deals }, { data: services }, { data: members }] = await Promise.all([
    supabase.from('steel_deals').select('*'),
    supabase.from('steel_deal_services').select('*'),
    supabase.from('team_members').select('id, name'),
  ])

  const memberName = new Map((members ?? []).map((m) => [m.id, m.name]))
  const servicesByDeal = new Map<string, typeof services>()
  for (const s of services ?? []) {
    const list = servicesByDeal.get(s.deal_id) ?? []
    list.push(s)
    servicesByDeal.set(s.deal_id, list)
  }

  let revenue = 0
  let cost = 0
  let margin = 0
  const salesTotal = emptyAgg()
  const refTotal = emptyAgg()
  const bySalesperson = new Map<string, Agg>()
  const byReferrer = new Map<string, Agg>()
  const byService = new Map<string, { revenue: number; cost: number; margin: number }>()
  const payouts: PayoutItem[] = []
  const svcLabel = (t: string) => (isSteelServiceType(t) ? STEEL_SERVICE_LABELS[t] : t)

  // Lost deals earn nothing — exclude them from every rollup.
  const liveDeals = (deals ?? []).filter((d) => !isLostStage(d.stage))

  for (const deal of liveDeals) {
    const rows = servicesByDeal.get(deal.id) ?? []
    const fin = dealFinancials(rows, deal.referral_fee_type, deal.referral_fee_value)
    revenue += fin.revenue
    cost += fin.cost
    margin += fin.margin

    for (const s of rows) {
      const comm = serviceCommission(s)
      if (s.commission_paid) salesTotal.paid += comm
      else salesTotal.owed += comm
      if (deal.salesperson_id) {
        const a = bySalesperson.get(deal.salesperson_id) ?? emptyAgg()
        if (s.commission_paid) a.paid += comm
        else a.owed += comm
        bySalesperson.set(deal.salesperson_id, a)
      }
      const st = byService.get(s.service_type) ?? { revenue: 0, cost: 0, margin: 0 }
      st.revenue += n(s.price)
      st.cost += n(s.cost)
      st.margin += serviceMargin(s)
      byService.set(s.service_type, st)

      if (comm !== 0) {
        payouts.push({
          key: `service:${s.id}`,
          kind: 'service',
          id: s.id,
          dealId: deal.id,
          dealName: deal.name,
          personName: deal.salesperson_id ? memberName.get(deal.salesperson_id) ?? 'Unknown' : 'Unassigned',
          detail: `${svcLabel(s.service_type)} commission`,
          amount: comm,
          paid: s.commission_paid,
        })
      }
    }

    if (fin.referralFee > 0) {
      if (deal.referral_fee_paid) refTotal.paid += fin.referralFee
      else refTotal.owed += fin.referralFee
      const key = deal.lead_source_id ?? '__none__'
      const a = byReferrer.get(key) ?? emptyAgg()
      if (deal.referral_fee_paid) a.paid += fin.referralFee
      else a.owed += fin.referralFee
      byReferrer.set(key, a)

      payouts.push({
        key: `referral:${deal.id}`,
        kind: 'referral',
        id: deal.id,
        dealId: deal.id,
        dealName: deal.name,
        personName: deal.lead_source_id ? memberName.get(deal.lead_source_id) ?? 'Unknown' : 'Unlinked referrer',
        detail: 'Referral fee',
        amount: fin.referralFee,
        paid: deal.referral_fee_paid,
      })
    }
  }

  const totalCommissions = salesTotal.owed + salesTotal.paid + refTotal.owed + refTotal.paid
  const net = margin - totalCommissions

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/steel"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          Steel CRM
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">Commissions &amp; Margin</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Across all active deals ({liveDeals.length}). Lost deals excluded. Owed = commissions not yet
          marked paid.
        </p>
      </div>

      {/* Headline band */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Revenue" value={formatValue(revenue)} sub="Sum of service prices" />
        <Stat label="Cost" value={formatValue(cost)} sub="Our cost / payouts" />
        <Stat label="Margin" value={formatValue(margin)} sub="Revenue − cost" tone="indigo" />
        <Stat label="Net after comm." value={formatValue(net)} sub="Margin − commissions" tone="emerald" />
      </div>

      {/* Payout worklist — mark commissions/referral fees paid */}
      <SteelPayoutList items={payouts} />

      {/* Owed vs paid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <OwedPaid title="Salesperson commissions" agg={salesTotal} />
        <OwedPaid title="Referral fees" agg={refTotal} />
      </div>

      {/* By salesperson */}
      <PeopleTable
        title="By salesperson"
        rows={[...bySalesperson.entries()]
          .map(([id, a]) => ({ name: memberName.get(id) ?? 'Unknown', ...a }))
          .sort((a, b) => b.owed + b.paid - (a.owed + a.paid))}
        emptyLabel="No salesperson commissions yet."
      />

      {/* By referrer */}
      <PeopleTable
        title="By referral source"
        rows={[...byReferrer.entries()]
          .map(([id, a]) => ({
            name: id === '__none__' ? 'Unlinked referrer' : memberName.get(id) ?? 'Unknown',
            ...a,
          }))
          .sort((a, b) => b.owed + b.paid - (a.owed + a.paid))}
        emptyLabel="No referral fees yet."
      />

      {/* By service */}
      <section className="rounded-lg border border-border bg-card p-4 elev-1">
        <h2 className="label-caps text-muted-foreground mb-3">By service</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
                <th className="font-medium pb-2 pr-3">Service</th>
                <th className="font-medium pb-2 px-3 text-right">Revenue</th>
                <th className="font-medium pb-2 px-3 text-right">Cost</th>
                <th className="font-medium pb-2 pl-3 text-right">Margin</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {STEEL_SERVICE_TYPES.filter((t) => byService.has(t)).map((t) => {
                const s = byService.get(t)!
                return (
                  <tr key={t} className="border-t border-border">
                    <td className="py-2 pr-3 font-medium">
                      {isSteelServiceType(t) ? STEEL_SERVICE_LABELS[t] : t}
                    </td>
                    <td className="py-2 px-3 text-right">{formatValue(s.revenue)}</td>
                    <td className="py-2 px-3 text-right">{formatValue(s.cost)}</td>
                    <td className="py-2 pl-3 text-right">{formatValue(s.margin)}</td>
                  </tr>
                )
              })}
              {byService.size === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-xs text-muted-foreground">
                    No service data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'indigo' | 'emerald'
}) {
  const dot = tone === 'indigo' ? 'bg-indigo-500' : tone === 'emerald' ? 'bg-emerald-500' : null
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 elev-1">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {dot && <span className={`size-1.5 rounded-full ${dot}`} />}
        {label}
      </p>
      <p className="text-lg font-semibold tnum mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function OwedPaid({ title, agg }: { title: string; agg: Agg }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 elev-1">
      <p className="label-caps text-muted-foreground">{title}</p>
      <div className="mt-2 flex items-end gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-amber-600 dark:text-amber-400">Owed</p>
          <p className="text-xl font-semibold tnum">{formatValue(agg.owed)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Paid</p>
          <p className="text-xl font-semibold tnum">{formatValue(agg.paid)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="text-xl font-semibold tnum">{formatValue(agg.owed + agg.paid)}</p>
        </div>
      </div>
    </div>
  )
}

function PeopleTable({
  title,
  rows,
  emptyLabel,
}: {
  title: string
  rows: { name: string; owed: number; paid: number }[]
  emptyLabel: string
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 elev-1">
      <h2 className="label-caps text-muted-foreground mb-3">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
              <th className="font-medium pb-2 pr-3">Person</th>
              <th className="font-medium pb-2 px-3 text-right">Owed</th>
              <th className="font-medium pb-2 px-3 text-right">Paid</th>
              <th className="font-medium pb-2 pl-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border">
                <td className="py-2 pr-3 font-medium">{r.name}</td>
                <td className="py-2 px-3 text-right">{formatValue(r.owed)}</td>
                <td className="py-2 px-3 text-right">{formatValue(r.paid)}</td>
                <td className="py-2 pl-3 text-right font-semibold">{formatValue(r.owed + r.paid)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-xs text-muted-foreground">
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
