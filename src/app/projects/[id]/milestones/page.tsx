import { createAdminClient } from '@/lib/supabase/admin'
import MilestonesTab from '@/components/projects/MilestonesTab'
import { STAGES, STAGE_LABELS } from '@/lib/utils/stages'

export const metadata = { title: 'Milestones — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function MilestonesPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [{ data: milestones }, { data: project }] = await Promise.all([
    supabase
      .from('milestones')
      .select('*')
      .eq('project_id', id)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
    supabase
      .from('projects')
      .select('id, stage')
      .eq('id', id)
      .single(),
  ])

  return (
    <MilestonesTab
      recordKind="project"
      recordId={id}
      initialMilestones={milestones ?? []}
      stages={STAGES}
      stageLabels={STAGE_LABELS}
      initialStage={project?.stage ?? 'pursuit'}
      advance={{ url: `/api/projects/${id}/stage`, field: 'stage' }}
    />
  )
}
