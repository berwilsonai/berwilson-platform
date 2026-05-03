import { createAdminClient } from '@/lib/supabase/admin'
import DiligenceTab from '@/components/projects/DiligenceTab'
import type { Party, Document, ResearchArtifact } from '@/lib/supabase/types'

export const metadata = { title: 'Diligence — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DiligencePage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: project },
    { data: ddItems },
    { data: complianceItems },
    { data: playersRaw },
    { data: documents },
    { data: researchArtifacts },
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('name, client_entity, solicitation_number')
      .eq('id', id)
      .single(),
    supabase
      .from('dd_items')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('compliance_items')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('project_players')
      .select('parties(*)')
      .eq('project_id', id),
    supabase
      .from('documents')
      .select('*')
      .eq('project_id', id)
      .order('uploaded_at', { ascending: false }),
    supabase
      .from('research_artifacts')
      .select('*')
      .eq('project_id', id)
      .order('retrieved_at', { ascending: false }),
  ])

  // Extract party records from the junction join, deduplicate by id
  const partiesMap = new Map<string, Party>()
  for (const row of (playersRaw ?? []) as unknown as { parties: Party | null }[]) {
    if (row.parties) partiesMap.set(row.parties.id, row.parties)
  }
  const parties = Array.from(partiesMap.values())

  return (
    <DiligenceTab
      projectId={id}
      projectName={project?.name ?? ''}
      clientEntity={project?.client_entity ?? null}
      solicitationNumber={project?.solicitation_number ?? null}
      initialDdItems={ddItems ?? []}
      initialComplianceItems={complianceItems ?? []}
      initialResearchArtifacts={(researchArtifacts ?? []) as ResearchArtifact[]}
      parties={parties}
      documents={(documents ?? []) as Document[]}
    />
  )
}
