import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import ComplianceClient from '@/components/portfolio/ComplianceClient'

export default async function CompliancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: site },
    { data: complianceItems },
  ] = await Promise.all([
    supabase.from('sites').select('id').eq('id', id).single(),
    supabase.from('compliance_items').select('*').eq('site_id', id).order('framework').order('created_at'),
  ])

  if (!site) notFound()

  return (
    <ComplianceClient
      siteId={id}
      initialItems={complianceItems ?? []}
    />
  )
}
