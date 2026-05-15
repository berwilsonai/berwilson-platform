import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import CapitalStackClient from '@/components/portfolio/CapitalStackClient'

export default async function CapitalStackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: site },
    { data: components },
    { data: funding },
    { data: revenueShare },
  ] = await Promise.all([
    supabase.from('sites').select('id, name').eq('id', id).single(),
    supabase.from('components').select('id, name, type, capital_low, capital_mid, capital_high').eq('site_id', id).order('phase'),
    supabase.from('funding_sources').select('*').eq('site_id', id).order('created_at'),
    supabase.from('revenue_share_agreements').select('*').eq('site_id', id).maybeSingle(),
  ])

  if (!site) notFound()

  return (
    <CapitalStackClient
      siteId={id}
      components={components ?? []}
      initialFunding={funding ?? []}
      initialRevenueShare={revenueShare ?? null}
    />
  )
}
