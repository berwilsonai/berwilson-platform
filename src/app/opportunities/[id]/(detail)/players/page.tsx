import { createAdminClient } from '@/lib/supabase/admin'
import RecordPlayers, { type PlayerRow } from '@/components/records/RecordPlayers'
import { contactRoleViews } from '@/lib/contacts/roles'
import { getViewer } from '@/lib/auth/viewer'

export const metadata = { title: 'Players — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function OpportunityPlayersPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const viewer = await getViewer()
  const limited = !(viewer?.isAdmin ?? true)

  const { data, error } = await supabase
    .from('project_players')
    .select(`
      id, role, role_key, is_primary, notes,
      parties(id, full_name, company, title, email, phone, is_organization)
    `)
    .eq('opportunity_id', id)
    .order('is_primary', { ascending: false })

  if (error) throw new Error(`Failed to load players: ${error.message}`)

  const roles = await contactRoleViews()

  return (
    <RecordPlayers
      recordKind="opportunity"
      recordId={id}
      players={(data as PlayerRow[]) ?? []}
      limited={limited}
      roles={roles}
    />
  )
}
