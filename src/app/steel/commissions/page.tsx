import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, canSeeSteelFinancials } from '@/lib/auth/viewer'
import { formatValue } from '@/lib/utils/constants'
import { isLostStage, ACCELERATOR_THRESHOLD } from '@/lib/utils/steel'
import {
  groupServices,
  financialsFor,
  acceleratorMap,
  payoutItems,
  repScorecards,
  referralSourceRollup,
} from '@/lib/steel/rollups'
import SteelPayoutList from '@/components/steel/SteelPayoutList'
import RepScorecardTable from '@/components/steel/RepScorecardTable'
import ReferralSourceTable from '@/components/steel/ReferralSourceTable'
import SteelWorkspaceTabs from '@/components/steel/SteelWorkspaceTabs'

export const metadata = { title: 'Steel Commissions — Ber Wilson Intelligence' }

export default async function SteelCommissionsPage() {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) redirect('/steel')
  // Confidential — steel_sales can reach /steel but not the company report.
  if (!canSeeSteelFinancials(viewer)) redirect('/steel/earnings')

  const supabase = createAdminClient()
  const [{ data: deals }, { data: services }, { data: members }] = await Promise.all([
    supabase.from('steel_deals').select('*'),
    supabase.from('steel_deal_services').select('*'),
    supabase.from('team_members').select('id, name'),
  ])

  // Resolve marketing/referral source names (parties) for the referral payouts.
  const referralPartyIds = [...new Set((deals ?? []).map((d) => d.referral_party_id).filter((x): x is string => !!x))]
  const partyName = new Map<string, string>()
  if (referralPartyIds.length > 0) {
    const { data: parties } = await supabase.from('parties').select('id, full_name').in('id', referralPartyIds)
    for (const p of parties ?? []) partyName.set(p.id, p.full_name)
  }

  const year = new Date().getFullYear()
  const rows = groupServices(deals ?? [], services ?? [])
  const accel = acceleratorMap(rows, year)
  const liveRows = rows.filter((r) => !isLostStage(r.deal.stage))

  // Company totals across active deals (fully-loaded net if all close & pay).
  let revenue = 0
  let cost = 0
  let margin = 0
  let totalPayout = 0
  for (const row of liveRows) {
    const fin = financialsFor(row, accel)
    revenue += fin.revenue
    cost += fin.cost
    margin += fin.margin
    totalPayout += fin.totalPayout
  }
  const net = margin - totalPayout

  const payouts = payoutItems(rows, members ?? [], partyName)
  const scorecards = repScorecards(rows, members ?? [], year)
  const referralSources = referralSourceRollup(rows, partyName)

  return (
    <div className="space-y-6">
      <SteelWorkspaceTabs active="commissions" showFinancials />


      <div>
        <h1 className="text-lg font-semibold">Commissions &amp; Margin</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Across all active deals ({liveRows.length}). Lost deals excluded. Commissions are{' '}
          <span className="font-medium text-foreground">owed only once a deal is collected (Paid stage)</span> — open
          deals show as projected. Rate is set by project size; installation is a flat fee; each rep gains +1pt after
          collecting {formatValue(ACCELERATOR_THRESHOLD)} of profit in a calendar year.
        </p>
      </div>

      {/* Headline band */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Revenue" value={formatValue(revenue)} sub="Sum of line prices" />
        <Stat label="Cost" value={formatValue(cost)} sub="Our cost / payouts" />
        <Stat label="Margin" value={formatValue(margin)} sub="Revenue − cost" tone="indigo" />
        <Stat label="Net after comm." value={formatValue(net)} sub="Margin − all payouts" tone="emerald" />
      </div>

      {/* Payout worklist — mark commissions/fees paid */}
      <SteelPayoutList items={payouts} />

      {/* Per-rep scorecards */}
      <RepScorecardTable scorecards={scorecards} year={year} />

      {/* Referral fees by marketing / referral source */}
      <ReferralSourceTable sources={referralSources} />
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
