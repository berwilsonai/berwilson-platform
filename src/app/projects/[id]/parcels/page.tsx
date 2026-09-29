import { getViewer, canAccessProject } from '@/lib/auth/viewer'
import { getProjectParcels } from '@/lib/parcels/queries'
import LandTab from '@/components/projects/LandTab'

export const metadata = { title: 'Land — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ParcelsPage({ params }: PageProps) {
  const { id } = await params
  const [parcels, viewer] = await Promise.all([getProjectParcels(id), getViewer()])
  const canEdit = !viewer || viewer.isAdmin || (await canAccessProject(viewer, id))

  return <LandTab projectId={id} parcels={parcels} canEdit={canEdit} />
}
