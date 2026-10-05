import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessOpportunity, getViewer } from '@/lib/auth/viewer'
import EconomicsView from '@/components/economics/EconomicsView'

export const metadata = { title: 'Economics — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function OpportunityEconomicsPage({ params }: PageProps) {
  const { id } = await params

  const [viewer, { data: opportunity }] = await Promise.all([
    getViewer(),
    createAdminClient().from('opportunities').select('name').eq('id', id).single(),
  ])
  const canEdit = !viewer || viewer.isAdmin || (await canAccessOpportunity(viewer, id))

  return (
    <EconomicsView
      recordKind="opportunity"
      recordId={id}
      recordName={opportunity?.name ?? 'this deal'}
      canEdit={canEdit}
    />
  )
}
