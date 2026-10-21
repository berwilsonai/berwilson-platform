import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { listContactRoles } from '@/lib/contacts/roles'
import ContactRoleManager, {
  type RoleCounts,
  type RoleRow,
} from '@/components/settings/ContactRoleManager'

export const metadata = { title: 'Contact roles — Ber Wilson Intelligence' }

export default async function ContactRolesSettingsPage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const roles = await listContactRoles()
  const db = createAdminClient()

  /**
   * How many hold each role — the figure that decides whether it can be
   * deleted, so the screen shows it before the reader tries.
   *
   * ⚠ Two counts, not one. A role can be unheld by any CONTACT and still be on
   * a project player, and the FK that refuses the delete is satisfied by
   * either — a single number would make the refusal unexplainable.
   *
   * ⚠ Counted with count(*) per role rather than read off
   * pg_stat_user_tables, which is a STALE ESTIMATE and has been wrong here by
   * an order of magnitude (§12). Cheap: two head-only queries each against an
   * indexed column.
   */
  const counts: RoleCounts = {}
  await Promise.all(
    roles.map(async (r) => {
      const [{ count: contacts }, { count: players }] = await Promise.all([
        db.from('party_roles').select('id', { count: 'exact', head: true }).eq('role_key', r.key),
        db
          .from('project_players')
          .select('id', { count: 'exact', head: true })
          .eq('role_key', r.key),
      ])
      counts[r.key] = { contacts: contacts ?? 0, players: players ?? 0 }
    })
  )

  const rows: RoleRow[] = roles.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    role_group: r.role_group,
    extraction_hint: r.extraction_hint,
    sort_order: r.sort_order,
    active: r.active,
    system: r.system,
  }))

  return <ContactRoleManager initial={rows} counts={counts} />
}
