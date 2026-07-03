import { createAdminClient } from '@/lib/supabase/admin'
import ObjectivesBoard, { type BoardObjective } from '@/components/objectives/ObjectivesBoard'
import type { TeamMember } from '@/components/tasks/task-utils'

export const metadata = { title: 'Objectives — Ber Wilson Intelligence' }

export default async function ObjectivesPage() {
  const supabase = createAdminClient()

  const [{ data: objectives, error }, { data: members }] = await Promise.all([
    supabase
      .from('objectives')
      .select('*, owner:team_members(id, name, color)')
      .order('sort_order', { ascending: true }),
    supabase
      .from('team_members')
      .select('id, name, color')
      .eq('active', true)
      .order('created_at', { ascending: true }),
  ])

  if (error) {
    throw new Error(`Failed to load objectives: ${error.message}`)
  }

  return (
    <ObjectivesBoard
      initialObjectives={(objectives ?? []) as unknown as BoardObjective[]}
      teamMembers={(members ?? []) as TeamMember[]}
    />
  )
}
