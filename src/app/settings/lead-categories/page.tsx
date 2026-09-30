import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { leadsDb } from '@/lib/leads/db'
import { listCategories } from '@/lib/leads/categories'
import LeadCategoryManager, {
  type CategoryRow,
  type LaneCounts,
} from '@/components/settings/LeadCategoryManager'

export const metadata = { title: 'Lead categories — Ber Wilson Intelligence' }

export default async function LeadCategoriesSettingsPage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const categories = await listCategories()

  // How many leads each lane owns — the figure that decides whether a lane can
  // be deleted, so the screen shows it before the reader tries.
  //
  // ⚠ Counted with count(*) per lane rather than read off pg_stat_user_tables,
  // which is a STALE ESTIMATE and has been wrong here by an order of magnitude
  // (§12, 09-24). Cheap: eight head-only queries against an indexed column.
  const counts: LaneCounts = {}
  await Promise.all(
    categories.map(async (c) => {
      const { count } = await leadsDb()
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('route', c.key)
      counts[c.key] = count ?? 0
    })
  )

  // The handoff address and the share list DO reach this page, unlike the leads
  // queue — this is the screen where they are edited, and it is admin-only.
  const rows: CategoryRow[] = categories.map((c) => ({
    id: c.id,
    key: c.key,
    label: c.label,
    destination: c.destination,
    routing_rule: c.routing_rule,
    destination_note: c.destination_note,
    handoff_email: c.handoff_email,
    share_with: c.share_with,
    drive_folder_id: c.drive_folder_id,
    publish_sheet: c.publish_sheet,
    chat_webhook_key: c.chat_webhook_key,
    tone: c.tone,
    sort_order: c.sort_order,
    active: c.active,
    system: c.system,
  }))

  return <LeadCategoryManager initial={rows} counts={counts} />
}
