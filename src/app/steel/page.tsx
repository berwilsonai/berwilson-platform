import Link from 'next/link'
import { Plus, Factory } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canSeeSteelFinancials } from '@/lib/auth/viewer'
import { groupServices, repScorecards } from '@/lib/steel/rollups'
import EmptyState from '@/components/shared/EmptyState'
import SteelWorkspaceTabs from '@/components/steel/SteelWorkspaceTabs'
import SteelPipelineBoard from '@/components/steel/SteelPipelineBoard'
import { type SteelDealCardData } from '@/components/steel/SteelDealsClient'

export const metadata = { title: 'Steel CRM — Ber Wilson Intelligence' }

export default async function SteelPage() {
  const supabase = createAdminClient()

  // Small dataset — fetch everything once; the board filters/re-scopes in memory.
  const [{ data: dealRows, error }, { data: services }, { data: members }, viewer] = await Promise.all([
    supabase.from('steel_deals').select('*').order('updated_at', { ascending: false }),
    supabase.from('steel_deal_services').select('*'),
    supabase.from('team_members').select('id, name').eq('active', true).order('created_at', { ascending: true }),
    getViewer(),
  ])
  const showFinancials = canSeeSteelFinancials(viewer)

  if (error) {
    throw new Error(`Failed to load steel deals: ${error.message}`)
  }

  const memberName = new Map((members ?? []).map((m) => [m.id, m.name]))

  // Resolve marketing/referral source names (parties) for the cards.
  const referralPartyIds = [
    ...new Set((dealRows ?? []).map((d) => d.referral_party_id).filter((x): x is string => !!x)),
  ]
  const partyName = new Map<string, string>()
  if (referralPartyIds.length > 0) {
    const { data: parties } = await supabase.from('parties').select('id, full_name').in('id', referralPartyIds)
    for (const p of parties ?? []) partyName.set(p.id, p.full_name)
  }

  const items: SteelDealCardData[] = (dealRows ?? []).map((deal) => ({
    deal,
    salesperson: deal.salesperson_id ? memberName.get(deal.salesperson_id) ?? null : null,
    referrer: deal.referral_party_id ? partyName.get(deal.referral_party_id) ?? null : null,
  }))

  // The viewer's own commission standing (owed vs projected) — viewer-fixed,
  // shown in the board's stat band so a rep sees their stake without leaving.
  const me = viewer?.teamMemberId ?? null
  let myOwed = 0
  let myProjected = 0
  if (me) {
    const rows = groupServices(dealRows ?? [], services ?? [])
    const card = repScorecards(rows, members ?? [], new Date().getFullYear(), me)[0]
    myOwed = card?.totalOwed ?? 0
    myProjected = card?.totalProjected ?? 0
  }

  return (
    <div className="space-y-5">
      <SteelWorkspaceTabs active="pipeline" showFinancials={showFinancials} />

      {items.length === 0 ? (
        <EmptyState
          icon={Factory}
          title="No steel deals yet"
          description="Track prefab steel deals from quote through engineering, order, delivery, and payment."
          action={
            <Link
              href="/steel/new"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} />
              New Deal
            </Link>
          }
        />
      ) : (
        <SteelPipelineBoard
          items={items}
          salespeople={members ?? []}
          myMemberId={me}
          myOwed={myOwed}
          myProjected={myProjected}
        />
      )}
    </div>
  )
}
