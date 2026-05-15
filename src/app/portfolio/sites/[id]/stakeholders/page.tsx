import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import StakeholdersClient from '@/components/portfolio/StakeholdersClient'

export default async function StakeholdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: site },
    { data: stakeholders },
  ] = await Promise.all([
    supabase.from('sites').select('id').eq('id', id).single(),
    supabase
      .from('stakeholder_relationships')
      .select('*, party:parties(id, full_name, company, title, email, phone)')
      .eq('site_id', id)
      .order('temperature'),
  ])

  if (!site) notFound()

  const srIds = (stakeholders ?? []).map(sr => sr.id)
  const { data: interactionsRaw } = srIds.length > 0
    ? await supabase
        .from('stakeholder_interactions')
        .select('*')
        .in('relationship_id', srIds)
        .order('interaction_date', { ascending: false })
        .limit(100)
    : { data: [] as { id: string; relationship_id: string; interaction_date: string; medium: string | null; summary: string; follow_up: string | null; logged_by: string | null; created_at: string }[] }

  const interactionsByRelationship: Record<string, typeof interactionsRaw> = {}
  for (const i of interactionsRaw ?? []) {
    if (!interactionsByRelationship[i.relationship_id]) {
      interactionsByRelationship[i.relationship_id] = []
    }
    interactionsByRelationship[i.relationship_id]!.push(i)
  }

  return (
    <StakeholdersClient
      siteId={id}
      initialStakeholders={(stakeholders ?? []) as any}
      interactionsByRelationship={interactionsByRelationship as any}
    />
  )
}
