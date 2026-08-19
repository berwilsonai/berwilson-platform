import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, canSeeSteelFinancials } from '@/lib/auth/viewer'
import { leadSourcesInUse } from '@/lib/steel/lead-sources'
import SteelDealForm from '@/components/steel/SteelDealForm'

export const metadata = { title: 'New Steel Deal — Ber Wilson Intelligence' }

export default async function NewSteelDealPage() {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) redirect('/steel')

  const supabase = createAdminClient()
  const [{ data: members }, { data: contacts }, leadSources] = await Promise.all([
    supabase
      .from('team_members')
      .select('id, name, is_steel_rep')
      .eq('active', true)
      .order('created_at', { ascending: true }),
    supabase
      .from('parties')
      .select('id, full_name, company, is_organization')
      .neq('status', 'archived')
      .order('full_name', { ascending: true }),
    leadSourcesInUse(supabase),
  ])

  // Salesperson list = flagged steel reps. Fall back to all active members
  // pre-migration / if nobody's flagged yet, so the form is never empty.
  const flagged = (members ?? []).filter((m) => m.is_steel_rep)
  const reps = flagged.length > 0 ? flagged : (members ?? [])

  return (
    <div className="space-y-5">
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
        <h1 className="text-lg font-semibold">New Steel Deal</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Track a prefab steel deal from quote to payment.
        </p>
      </div>

      <SteelDealForm
        mode="create"
        reps={reps.map((m) => ({ id: m.id, name: m.name }))}
        contacts={contacts ?? []}
        leadSources={leadSources}
        canSeeFinancials={canSeeSteelFinancials(viewer)}
      />
    </div>
  )
}
