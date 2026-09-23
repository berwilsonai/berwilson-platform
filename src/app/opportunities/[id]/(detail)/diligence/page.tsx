import { createAdminClient } from '@/lib/supabase/admin'
import DiligenceTab from '@/components/projects/DiligenceTab'
import type { Party, ResearchArtifact } from '@/lib/supabase/types'

export const metadata = { title: 'Diligence — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function OpportunityDiligencePage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: opportunity },
    { data: ddItems },
    { data: complianceItems },
    { data: playersRaw },
    { data: researchArtifacts },
  ] = await Promise.all([
    supabase.from('opportunities').select('name, counterparty, target_name').eq('id', id).single(),
    supabase.from('dd_items').select('*').eq('opportunity_id', id).order('created_at', { ascending: false }),
    supabase.from('compliance_items').select('*').eq('opportunity_id', id).order('created_at', { ascending: false }),
    supabase.from('project_players').select('parties(*)').eq('opportunity_id', id),
    supabase.from('research_artifacts').select('*').eq('opportunity_id', id).order('retrieved_at', { ascending: false }),
  ])

  // Diligence items are assigned to the people on the deal.
  const partiesMap = new Map<string, Party>()
  for (const row of (playersRaw ?? []) as unknown as { parties: Party | null }[]) {
    if (row.parties) partiesMap.set(row.parties.id, row.parties)
  }

  // No evidence-document picker here, deliberately: compliance_items.
  // evidence_doc_id is a foreign key to `documents`, while an opportunity's
  // files live in `opportunity_documents`. Offering them would produce a
  // 23503 on save. An empty list simply hides the picker; the item's notes
  // can name the file until that FK is widened.
  return (
    <DiligenceTab
      recordKind="opportunity"
      recordId={id}
      recordName={opportunity?.name ?? ''}
      counterparty={opportunity?.counterparty ?? opportunity?.target_name ?? null}
      initialDdItems={ddItems ?? []}
      initialComplianceItems={complianceItems ?? []}
      initialResearchArtifacts={(researchArtifacts ?? []) as ResearchArtifact[]}
      parties={Array.from(partiesMap.values())}
      documents={[]}
    />
  )
}
