import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import InvestorForm from '@/components/investors/InvestorForm'

export const metadata = { title: 'New Investor — Ber Wilson Intelligence' }

export default async function NewInvestorPage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/investors')

  const supabase = createAdminClient()
  const [{ data: parties }, { data: members }] = await Promise.all([
    supabase
      .from('parties')
      .select('id, full_name, company')
      .neq('status', 'archived')
      .order('full_name'),
    supabase
      .from('team_members')
      .select('id, name')
      .eq('active', true)
      .order('created_at', { ascending: true }),
  ])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/investors"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          Investors
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">New Investor</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Track a potential investor in the parent company or a project SPV.
        </p>
      </div>

      <InvestorForm mode="create" parties={parties ?? []} teamMembers={members ?? []} />
    </div>
  )
}
