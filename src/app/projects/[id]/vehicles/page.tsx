import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import VehiclesView from '@/components/spvs/VehiclesView'

export const metadata = { title: 'Vehicles — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectVehiclesPage({ params }: PageProps) {
  const { id } = await params

  // The layout already gated access and 404s a project this viewer cannot
  // reach, so this only asks the narrower question: may they EDIT it.
  //
  // ⚠ ADMIN AND NOTHING ELSE, because that is what /api/spvs actually enforces.
  // Offering edit controls to a role whose every save comes back "Admin only"
  // is a worse answer than not offering them.
  const viewer = await getViewer()
  const canEdit = viewer?.isAdmin ?? false

  const { data: project } = await createAdminClient()
    .from('projects')
    .select('name')
    .eq('id', id)
    .single()

  return (
    <VehiclesView
      recordKind="project"
      recordId={id}
      recordName={project?.name ?? 'this project'}
      canEdit={canEdit}
    />
  )
}
