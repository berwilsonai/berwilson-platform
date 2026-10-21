import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import RecordPlayers, { type PlayerRow } from '@/components/records/RecordPlayers'
import { contactRoleViews } from '@/lib/contacts/roles'
import { getViewer } from '@/lib/auth/viewer'

export const metadata = { title: 'Team — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PlayersPage({ params }: PageProps) {
  const { id: projectId } = await params
  const supabase = createAdminClient()

  // People data is executive-only. Non-admins (project managers) get a
  // limited read — see RecordPlayers.
  const viewer = await getViewer()
  const limited = !(viewer?.isAdmin ?? true)

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .single()

  if (!project) notFound()

  const { data, error } = await supabase
    .from('project_players')
    .select(`
      id, role, role_key, is_primary, notes,
      parties(id, full_name, company, title, email, phone, is_organization)
    `)
    .eq('project_id', projectId)
    .order('is_primary', { ascending: false })

  if (error) throw new Error(`Failed to load players: ${error.message}`)

  const roles = await contactRoleViews()

  return (
    <RecordPlayers
      recordKind="project"
      recordId={projectId}
      players={(data as PlayerRow[]) ?? []}
      limited={limited}
      roles={roles}
    />
  )
}
