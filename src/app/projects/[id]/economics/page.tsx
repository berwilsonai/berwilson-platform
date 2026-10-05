import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessProject, getViewer } from '@/lib/auth/viewer'
import EconomicsView from '@/components/economics/EconomicsView'

export const metadata = { title: 'Economics — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectEconomicsPage({ params }: PageProps) {
  const { id } = await params

  // The layout already gated access and 404s a project this viewer cannot
  // reach, so this only asks the narrower question: may they EDIT it.
  const [viewer, { data: project }] = await Promise.all([
    getViewer(),
    createAdminClient().from('projects').select('name').eq('id', id).single(),
  ])
  const canEdit = !viewer || viewer.isAdmin || (await canAccessProject(viewer, id))

  return (
    <EconomicsView
      recordKind="project"
      recordId={id}
      recordName={project?.name ?? 'this project'}
      canEdit={canEdit}
    />
  )
}
