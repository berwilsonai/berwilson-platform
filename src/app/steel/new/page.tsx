import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel } from '@/lib/auth/viewer'
import { leadSourcesInUse } from '@/lib/steel/lead-sources'
import SteelDealForm from '@/components/steel/SteelDealForm'

export const metadata = { title: 'New Steel Deal — Ber Wilson Intelligence' }

export default async function NewSteelDealPage() {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) redirect('/steel')

  const supabase = createAdminClient()
  const [{ data: members }, leadSources] = await Promise.all([
    supabase
      .from('team_members')
      .select('id, name')
      .eq('active', true)
      .order('created_at', { ascending: true }),
    leadSourcesInUse(supabase),
  ])

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

      <SteelDealForm mode="create" teamMembers={members ?? []} leadSources={leadSources} />
    </div>
  )
}
