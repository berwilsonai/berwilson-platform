import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel } from '@/lib/auth/viewer'
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
  const [{ data: deal }, { data: members }] = await Promise.all([
    supabase.from('steel_deals').select('*').eq('id', id).single(),
    supabase
      .from('team_members')
      .select('id, name')
      .eq('active', true)
      .order('created_at', { ascending: true }),
  ])

  if (!deal) notFound()

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

      <SteelDealForm mode="edit" deal={deal} teamMembers={members ?? []} />
    </div>
  )
}
