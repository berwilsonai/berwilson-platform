import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import InvestorForm from '@/components/investors/InvestorForm'

export const metadata = { title: 'Edit Investor — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditInvestorPage({ params }: PageProps) {
  const { id } = await params

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/investors')

  const supabase = createAdminClient()
  const [{ data: investor }, { data: parties }, { data: members }] = await Promise.all([
    supabase.from('investors').select('*, party:parties(id, full_name)').eq('id', id).single(),
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

  if (!investor) notFound()

  const party = investor.party as { id: string; full_name: string } | null
  // Strip the embed before handing the row to the form
  const { ...investorRow } = investor
  delete (investorRow as { party?: unknown }).party

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href={`/investors/${id}`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          {investor.name}
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">Edit Investor</h1>
      </div>

      <InvestorForm
        mode="edit"
        investor={investorRow}
        parties={parties ?? []}
        teamMembers={members ?? []}
        linkedPartyName={party?.full_name ?? null}
      />
    </div>
  )
}
