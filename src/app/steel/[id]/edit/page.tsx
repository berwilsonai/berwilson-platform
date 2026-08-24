import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, canSeeSteelFinancials } from '@/lib/auth/viewer'
import { leadSourcesInUse } from '@/lib/steel/lead-sources'
import SteelDealForm from '@/components/steel/SteelDealForm'

export const metadata = { title: 'Edit Steel Deal — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditSteelDealPage({ params }: PageProps) {
  const { id } = await params

  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) redirect('/steel')

  const supabase = createAdminClient()
  const [{ data: deal }, { data: members }, { data: services }, { data: contacts }, leadSources] =
    await Promise.all([
      supabase.from('steel_deals').select('*').eq('id', id).single(),
      supabase
        .from('team_members')
        .select('id, name, is_steel_rep')
        .eq('active', true)
        .order('created_at', { ascending: true }),
      supabase.from('steel_deal_services').select('*').eq('deal_id', id),
      supabase
        .from('parties')
        .select('id, full_name, company, is_organization')
        .neq('status', 'archived')
        .order('full_name', { ascending: true }),
      leadSourcesInUse(supabase),
    ])

  if (!deal) notFound()

  // Salesperson list = flagged steel reps, plus the deal's current salesperson
  // if they're not (a legacy assignment) so editing never silently drops them.
  const flagged = (members ?? []).filter((m) => m.is_steel_rep)
  let reps = flagged.length > 0 ? flagged : (members ?? [])
  if (deal.salesperson_id && !reps.some((r) => r.id === deal.salesperson_id)) {
    const current = (members ?? []).find((m) => m.id === deal.salesperson_id)
    if (current) reps = [current, ...reps]
  }

  // Current marketing/referral source (may be archived → fetch explicitly).
  let referralSource: { id: string; full_name: string } | null = null
  if (deal.referral_party_id) {
    const { data: p } = await supabase
      .from('parties')
      .select('id, full_name')
      .eq('id', deal.referral_party_id)
      .maybeSingle()
    referralSource = p ?? null
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href={`/steel/${id}`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          {deal.name}
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">Edit Steel Deal</h1>
      </div>

      <SteelDealForm
        mode="edit"
        deal={deal}
        reps={reps.map((m) => ({ id: m.id, name: m.name }))}
        contacts={contacts ?? []}
        referralSource={referralSource}
        leadSources={leadSources}
        services={services ?? []}
        canSeeFinancials={canSeeSteelFinancials(viewer)}
      />
    </div>
  )
}
