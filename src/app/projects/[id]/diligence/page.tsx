import { createAdminClient } from '@/lib/supabase/admin'
import DiligenceTab from '@/components/projects/DiligenceTab'
import type { Party, Document } from '@/lib/supabase/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DiligencePage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: ddItems },
    { data: complianceItems },
    { data: playersRaw },
    { data: documents },
  ] = await Promise.all([
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
      initialDdItems={ddItems ?? []}
      initialComplianceItems={complianceItems ?? []}
      parties={parties}
      documents={(documents ?? []) as Document[]}
    />
  )
}
