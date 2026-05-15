import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import SiteDocumentsClient from '@/components/portfolio/SiteDocumentsClient'

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: site },
    { data: documents },
  ] = await Promise.all([
    supabase.from('sites').select('id').eq('id', id).single(),
    supabase.from('documents').select('*').eq('site_id', id).order('uploaded_at', { ascending: false }),
  ])

  if (!site) notFound()

  return (
    <SiteDocumentsClient
      siteId={id}
      initialDocuments={documents ?? []}
    />
  )
}
