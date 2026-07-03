import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'

export async function GET() {
  const supabase = createAdminClient()

  // Return all projects that could be parents (no parent themselves, or already a parent)
  const { data, error } = await supabase
    .from('projects')
    .select('id, name')
    .is('parent_project_id', null)
    .in('status', ['active', 'on_hold'])
    .order('name')

  if (error) {
    return Response.json([], { status: 200 })
  }

  // Don't leak the rest of the pipeline to scoped users.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) {
    return Response.json((data || []).filter((p) => viewer.grantedProjectIds.includes(p.id)))
  }

  return Response.json(data || [])
}
