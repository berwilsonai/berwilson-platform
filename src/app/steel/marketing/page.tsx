import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, canSeeSteelFinancials } from '@/lib/auth/viewer'
import { formatValue } from '@/lib/utils/constants'
import {
  DEFAULT_LEAD_SOURCES,
  STEEL_MARKETING_MONTHLY_BUDGET,
  leadSourceLabel,
} from '@/lib/utils/steel'
import { leadSourcesInUse } from '@/lib/steel/lead-sources'
import { channelAnalytics, icpBreakdown, spendByMonth, type ChannelStat } from '@/lib/steel/marketing'
import SteelSpendLedger from '@/components/steel/SteelSpendLedger'
import SteelWorkspaceTabs from '@/components/steel/SteelWorkspaceTabs'

export const metadata = { title: 'Steel Marketing — Ber Wilson Intelligence' }

const pct = (v: number | null): string => (v == null ? '—' : `${Math.round(v * 100)}%`)
const money = (v: number | null): string => (v == null ? '—' : formatValue(v))
const mult = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)}×`)
const psf = (v: number | null): string =>
  v == null ? '—' : `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`

export default async function SteelMarketingPage() {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) redirect('/steel')
  const showFin = canSeeSteelFinancials(viewer)
  const canEdit = canWorkSteel(viewer)

  const supabase = createAdminClient()
  const [{ data: deals }, { data: services }, { data: spend }, sourcesInUse] = await Promise.all([
    supabase.from('steel_deals').select('*'),
    supabase.from('steel_deal_services').select('*'),
    supabase.from('steel_marketing_spend').select('*'),
    leadSourcesInUse(supabase),
  ])

  const { channels, totals } = channelAnalytics(deals ?? [], services ?? [], spend ?? [])
  const segments = icpBreakdown(deals ?? [], services ?? [], 'icp_segment')
  const triggers = icpBreakdown(deals ?? [], services ?? [], 'buying_trigger')
  const months = spendByMonth(spend ?? [], STEEL_MARKETING_MONTHLY_BUDGET, 6)

  // Channel suggestions for the ledger datalist: lead sources in use + defaults + spend channels.
  const channelSuggestions = Array.from(
    new Set([
      ...sourcesInUse.map(leadSourceLabel),
      ...DEFAULT_LEAD_SOURCES,
      ...(spend ?? []).map((s) => leadSourceLabel(s.channel)),
    ])
  ).sort()

  const thisMonth = months[months.length - 1]
  const maxBar = Math.max(STEEL_MARKETING_MONTHLY_BUDGET, ...months.map((m) => m.spend), 1)

  return (
    <div className="space-y-6">
      <SteelWorkspaceTabs active="marketing" showFinancials={showFin} />

      <div>
        <h1 className="text-lg font-semibold">Marketing</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Where leads come from, what they convert to, and what the media budget is buying. &ldquo;Won&rdquo; = order
          placed or beyond.
        </p>
      </div>

      {/* Spend vs budget */}
      <section className="rounded-lg border border-border bg-card p-4 elev-1">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="label-caps text-muted-foreground">Spend vs Budget</h2>
          <span className="text-[11px] text-muted-foreground">
            Budget {formatValue(STEEL_MARKETING_MONTHLY_BUDGET)}/mo
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label="This month" value={formatValue(thisMonth?.spend ?? 0)} sub={thisMonth?.label} />
          <Stat
            label="Remaining"
            value={formatValue(Math.max(0, STEEL_MARKETING_MONTHLY_BUDGET - (thisMonth?.spend ?? 0)))}
            sub="Of this month's budget"
          />
          <Stat label="Leads (all time)" value={String(totals.leads)} sub={`${totals.won} won`} />
          <Stat label="Blended CAC" value={money(totals.cac)} sub="Spend ÷ won deals" />
        </div>
        {/* Month bars */}
        <div className="space-y-1.5">
          {months.map((m) => {
            const over = m.spend > m.budget
            return (
              <div key={m.month} className="flex items-center gap-3 text-xs">
                <span className="w-16 shrink-0 text-muted-foreground">{m.label}</span>
                <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden relative">
                  <div
                    className={over ? 'h-full bg-red-500' : 'h-full bg-primary'}
                    style={{ width: `${Math.min(100, (m.spend / maxBar) * 100)}%` }}
                  />
                  {/* budget marker */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-foreground/40"
                    style={{ left: `${Math.min(100, (m.budget / maxBar) * 100)}%` }}
                    title={`Budget ${formatValue(m.budget)}`}
                  />
                </div>
                <span className={`w-20 shrink-0 text-right tnum ${over ? 'text-red-600 dark:text-red-400' : ''}`}>
                  {formatValue(m.spend)}
                </span>
              </div>
            )
          })}
          <p className="text-[11px] text-muted-foreground pt-1">Vertical line = monthly budget.</p>
        </div>
      </section>

      {/* Channel performance */}
      <section className="rounded-lg border border-border bg-card p-4 elev-1">
        <h2 className="label-caps text-muted-foreground mb-3">Channel Performance</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
                <th className="font-medium pb-2 pr-3">Channel</th>
                <th className="font-medium pb-2 px-3 text-right">Leads</th>
                <th className="font-medium pb-2 px-3 text-right">Won</th>
                <th className="font-medium pb-2 px-3 text-right">Win %</th>
                <th className="font-medium pb-2 px-3 text-right">Won Rev</th>
                <th className="font-medium pb-2 px-3 text-right">Avg $/SF</th>
                <th className="font-medium pb-2 px-3 text-right">Spend</th>
                <th className="font-medium pb-2 px-3 text-right">CAC</th>
                <th className="font-medium pb-2 px-3 text-right">ROAS</th>
                {showFin && <th className="font-medium pb-2 pl-3 text-right">Margin ROAS</th>}
              </tr>
            </thead>
            <tbody className="tnum">
              {channels.map((c) => (
                <ChannelRow key={c.channel} c={c} showFin={showFin} />
              ))}
              {channels.length === 0 && (
                <tr>
                  <td colSpan={showFin ? 10 : 9} className="py-3 text-center text-xs text-muted-foreground">
                    No deals yet.
                  </td>
                </tr>
              )}
            </tbody>
            {channels.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold tnum">
                  <td className="py-2 pr-3">All channels</td>
                  <td className="py-2 px-3 text-right">{totals.leads}</td>
                  <td className="py-2 px-3 text-right">{totals.won}</td>
                  <td className="py-2 px-3 text-right">{pct(totals.winRate)}</td>
                  <td className="py-2 px-3 text-right">{formatValue(totals.wonRevenue)}</td>
                  <td className="py-2 px-3 text-right">{psf(totals.avgPricePerSqft)}</td>
                  <td className="py-2 px-3 text-right">{formatValue(totals.spend)}</td>
                  <td className="py-2 px-3 text-right">{money(totals.cac)}</td>
                  <td className="py-2 px-3 text-right">{mult(totals.roas)}</td>
                  {showFin && <td className="py-2 pl-3 text-right">{mult(totals.roasMargin)}</td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Win % = won ÷ (won + lost) · CAC = spend ÷ won · ROAS = won revenue ÷ spend
          {showFin ? ' · Margin ROAS = won margin ÷ spend' : ''}. Channels match deal lead sources.
        </p>
      </section>

      {/* ICP breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <IcpTable title="By Buyer Segment" rows={segments} />
        <IcpTable title="By Buying Trigger" rows={triggers} />
      </div>

      {/* Spend ledger */}
      <SteelSpendLedger spend={spend ?? []} channels={channelSuggestions} canEdit={canEdit} />
    </div>
  )
}

function ChannelRow({ c, showFin }: { c: ChannelStat; showFin: boolean }) {
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-3 font-medium">{c.channel}</td>
      <td className="py-2 px-3 text-right">{c.leads}</td>
      <td className="py-2 px-3 text-right">{c.won}</td>
      <td className="py-2 px-3 text-right">{pct(c.winRate)}</td>
      <td className="py-2 px-3 text-right">{formatValue(c.wonRevenue)}</td>
      <td className="py-2 px-3 text-right">{psf(c.avgPricePerSqft)}</td>
      <td className="py-2 px-3 text-right">{formatValue(c.spend)}</td>
      <td className="py-2 px-3 text-right">{money(c.cac)}</td>
      <td className="py-2 px-3 text-right">{mult(c.roas)}</td>
      {showFin && <td className="py-2 pl-3 text-right">{mult(c.roasMargin)}</td>}
    </tr>
  )
}

function IcpTable({
  title,
  rows,
}: {
  title: string
  rows: { key: string; leads: number; won: number; wonRevenue: number; winRate: number | null }[]
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 elev-1">
      <h2 className="label-caps text-muted-foreground mb-3">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
              <th className="font-medium pb-2 pr-3">Segment</th>
              <th className="font-medium pb-2 px-3 text-right">Leads</th>
              <th className="font-medium pb-2 px-3 text-right">Won</th>
              <th className="font-medium pb-2 px-3 text-right">Win %</th>
              <th className="font-medium pb-2 pl-3 text-right">Won Rev</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="py-2 pr-3 font-medium">{r.key}</td>
                <td className="py-2 px-3 text-right">{r.leads}</td>
                <td className="py-2 px-3 text-right">{r.won}</td>
                <td className="py-2 px-3 text-right">{pct(r.winRate)}</td>
                <td className="py-2 pl-3 text-right">{formatValue(r.wonRevenue)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-xs text-muted-foreground">
                  No data yet — set the segment/trigger on deals.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 elev-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tnum mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}
