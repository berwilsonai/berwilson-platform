import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import OpportunityForm from '@/components/opportunities/OpportunityForm'
import { getViewer, canAccessOpportunity } from '@/lib/auth/viewer'

export const metadata = { title: 'Edit Opportunity — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditOpportunityPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: opportunity } = await supabase
    .from('opportunities')
    .select('*')
    .eq('id', id)
    .single()

  if (!opportunity) notFound()

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin && !canAccessOpportunity(viewer, id)) notFound()

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href={`/opportunities/${id}`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          {opportunity.name}
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">Edit Opportunity</h1>
      </div>

      <OpportunityForm mode="edit" opportunity={opportunity} />
    </div>
  )
}
