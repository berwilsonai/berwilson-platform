import { createAdminClient } from '@/lib/supabase/admin'
import MilestonesTab from '@/components/projects/MilestonesTab'

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
      projectId={id}
      initialMilestones={milestones ?? []}
      initialStage={project?.stage ?? 'pursuit'}
    />
  )
}
