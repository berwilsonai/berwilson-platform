import { createAdminClient } from '@/lib/supabase/admin'
import EntitiesTab from '@/components/projects/EntitiesTab'
import type { Entity, EntityProject, ResearchArtifact } from '@/lib/supabase/types'

export const metadata = { title: 'Entities & Vendors — Ber Wilson Intelligence' }

export type EntityProjectWithEntity = EntityProject & { entity: Entity }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EntitiesPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [{ data: allEntities }, { data: linkedRaw }, { data: researchArtifacts }] = await Promise.all([
    supabase.from('entities').select('*').order('name', { ascending: true }),
    supabase
      .from('entity_projects')
      .select('*, entity:entities(*)')
      .eq('project_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('research_artifacts')
      .select('*')
      .eq('project_id', id)
      .order('retrieved_at', { ascending: false }),
  ])

  return (
    <EntitiesTab
      projectId={id}
      initialLinked={(linkedRaw ?? []) as EntityProjectWithEntity[]}
      initialAllEntities={allEntities ?? []}
      initialResearchArtifacts={(researchArtifacts ?? []) as ResearchArtifact[]}
    />
  )
}
