import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, canSeeSteelFinancials } from '@/lib/auth/viewer'
import { formatValue } from '@/lib/utils/constants'
import { isLostStage, isCommissionPayable, ACCELERATOR_THRESHOLD } from '@/lib/utils/steel'
import { groupServices, acceleratorMap, financialsFor, repScorecards, type RepBucket } from '@/lib/steel/rollups'
import SteelWorkspaceTabs from '@/components/steel/SteelWorkspaceTabs'

export const metadata = { title: 'My Earnings — Ber Wilson Intelligence' }

interface MyDeal {
  id: string
  name: string
  roles: string[]
  amount: number
  payable: boolean
  paid: boolean
}

function statusLabel(payable: boolean, paid: boolean): string {
  if (!payable) return 'Projected'
  return paid ? 'Paid' : 'Owed'
}

export default async function SteelEarningsPage() {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) redirect('/steel')
  const showFinancials = canSeeSteelFinancials(viewer)

  if (!viewer?.teamMemberId) {
    return (
      <div className="space-y-4">
        <SteelWorkspaceTabs active="earnings" showFinancials={showFinancials} />
        <h1 className="text-lg font-semibold">My Earnings</h1>
        <p className="text-sm text-muted-foreground">
          Your login isn&apos;t linked to a team member yet, so there are no commissions to show. Ask an admin to link
          your account under Users.
        </p>
      </div>
    )
  }

  const me = viewer.teamMemberId
  const supabase = createAdminClient()
  const [{ data: deals }, { data: services }, { data: members }] = await Promise.all([
    supabase.from('steel_deals').select('*'),
    supabase.from('steel_deal_services').select('*'),
    supabase.from('team_members').select('id, name'),
  ])

  const year = new Date().getFullYear()
  const rows = groupServices(deals ?? [], services ?? [])
  const accel = acceleratorMap(rows, year)
  const card = repScorecards(rows, members ?? [], year, me)[0]

  // My deals: deals I'm the salesperson on, with my cut (sales + install).
  const myDeals: MyDeal[] = []
  for (const row of rows) {
    const { deal } = row
    if (isLostStage(deal.stage)) continue
    if (deal.salesperson_id !== me) continue

    const fin = financialsFor(row, accel)
    const payable = isCommissionPayable(deal.stage)
    const roles: string[] = []
    let amount = 0
    let paid = true
    roles.push('Sales')
    amount += fin.salesCommission
    paid = paid && deal.sales_commission_paid
    if (fin.installFee > 0) {
      roles.push('Install')
      amount += fin.installFee
      paid = paid && deal.install_fee_paid
    }
    if (amount === 0) continue
    myDeals.push({ id: deal.id, name: deal.name, roles, amount, payable, paid })
  }
  myDeals.sort((a, b) => Number(a.payable) - Number(b.payable) || b.amount - a.amount)

  const accelPct = card ? Math.min(100, (card.collectedProfitYTD / ACCELERATOR_THRESHOLD) * 100) : 0

  return (
    <div className="space-y-6">
      <SteelWorkspaceTabs active="earnings" showFinancials={showFinancials} />

      <div>
        <h1 className="text-lg font-semibold">My Earnings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your commissions across the steel pipeline. Commissions are <span className="font-medium text-foreground">owed
          only once a deal is collected</span> (Paid stage); open deals are projected.
        </p>
      </div>

      {/* Totals band */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Total sales" value={formatValue(card?.totalSales ?? 0)} sub="Revenue on my deals" />
        <Stat label="Owed to me" value={formatValue(card?.totalOwed ?? 0)} tone="amber" />
        <Stat label="Paid to me" value={formatValue(card?.totalPaid ?? 0)} tone="emerald" />
        <Stat label="Projected" value={formatValue(card?.totalProjected ?? 0)} sub="If open deals close" />
      </div>

      {/* Accelerator */}
      <section className="rounded-lg border border-border bg-card p-4 elev-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="label-caps text-muted-foreground">Volume Accelerator ({year})</h2>
          {card?.accelerated && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">
              +1 point active
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Collect {formatValue(ACCELERATOR_THRESHOLD)} of profit in a calendar year and your rate steps up 1 point for
          the rest of the year.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={card?.accelerated ? 'h-full bg-emerald-500' : 'h-full bg-primary'}
              style={{ width: `${accelPct}%` }}
            />
          </div>
          <span className="tnum text-sm font-medium shrink-0">
            {formatValue(card?.collectedProfitYTD ?? 0)}{' '}
            <span className="text-muted-foreground font-normal">/ {formatValue(ACCELERATOR_THRESHOLD)}</span>
          </span>
        </div>
      </section>

      {/* Breakdown by role */}
      {card && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <RoleCard label="Sales commission" bucket={card.sales} />
          <RoleCard label="Installation fees" bucket={card.install} />
        </div>
      )}

      {/* My deals */}
      <section className="rounded-lg border border-border bg-card p-4 elev-1">
        <h2 className="label-caps text-muted-foreground mb-3">My Deals</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
                <th className="font-medium pb-2 pr-3">Deal</th>
                <th className="font-medium pb-2 px-3">My role</th>
                <th className="font-medium pb-2 px-3 text-right">My commission</th>
                <th className="font-medium pb-2 pl-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {myDeals.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="py-2 pr-3">
                    <Link href={`/steel/${d.id}`} className="font-medium hover:underline">
                      {d.name}
                    </Link>
                  </td>
                  <td className="py-2 px-3 text-muted-foreground">{d.roles.join(' + ')}</td>
                  <td className="py-2 px-3 text-right">{formatValue(d.amount)}</td>
                  <td className="py-2 pl-3 text-right text-muted-foreground">{statusLabel(d.payable, d.paid)}</td>
                </tr>
              ))}
              {myDeals.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-xs text-muted-foreground">
                    No commissions yet. Deals you sell will appear here.
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

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'amber' | 'emerald' }) {
  const cls =
    tone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'emerald'
        ? 'text-emerald-600 dark:text-emerald-400'
        : ''
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 elev-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tnum mt-0.5 ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function RoleCard({ label, bucket }: { label: string; bucket: RepBucket }) {
  const total = bucket.owed + bucket.paid + bucket.projected
  return (
    <div className="rounded-lg border border-border bg-card p-3 elev-1">
      <p className="label-caps text-muted-foreground">{label}</p>
      {total === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">—</p>
      ) : (
        <dl className="mt-2 space-y-1 text-sm tnum">
          <Row k="Owed" v={bucket.owed} cls="text-amber-600 dark:text-amber-400" />
          <Row k="Paid" v={bucket.paid} cls="text-emerald-600 dark:text-emerald-400" />
          <Row k="Projected" v={bucket.projected} cls="text-muted-foreground" />
        </dl>
      )}
    </div>
  )
}

function Row({ k, v, cls }: { k: string; v: number; cls: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</dt>
      <dd className={cls}>{formatValue(v)}</dd>
    </div>
  )
}
