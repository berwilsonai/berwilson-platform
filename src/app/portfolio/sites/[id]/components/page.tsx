import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import ComponentsClient from '@/components/portfolio/ComponentsClient'

export default async function ComponentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: site },
    { data: components },
  ] = await Promise.all([
    supabase.from('sites').select('id').eq('id', id).single(),
    supabase.from('components').select('*').eq('site_id', id).order('phase').order('created_at'),
  ])

  if (!site) notFound()

  return (
    <ComponentsClient
      siteId={id}
      initialComponents={components ?? []}
    />
  )
}
