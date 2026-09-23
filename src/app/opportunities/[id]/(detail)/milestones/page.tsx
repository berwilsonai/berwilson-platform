import { createAdminClient } from '@/lib/supabase/admin'
import MilestonesTab from '@/components/projects/MilestonesTab'
import { OPPORTUNITY_PIPELINE, OPPORTUNITY_STATUS_LABELS, oppStatus } from '@/lib/utils/opportunities'

export const metadata = { title: 'Milestones — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function OpportunityMilestonesPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [{ data: milestones }, { data: opportunity }] = await Promise.all([
    supabase
      .from('milestones')
      .select('*')
      .eq('opportunity_id', id)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
    supabase.from('opportunities').select('id, status').eq('id', id).single(),
  ])

  // Milestones sit under the deal pipeline's own phases, and "advance" moves
  // the opportunity's status the way it moves a project's stage.
  return (
    <MilestonesTab
      recordKind="opportunity"
      recordId={id}
      initialMilestones={milestones ?? []}
      stages={OPPORTUNITY_PIPELINE}
      stageLabels={OPPORTUNITY_STATUS_LABELS}
      initialStage={oppStatus(opportunity?.status)}
      advance={{ url: `/api/opportunities/${id}`, field: 'status' }}
    />
  )
}
