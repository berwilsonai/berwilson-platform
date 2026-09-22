import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'

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
  // Unreachable behind the middleware, which 401s an unauthenticated request
  // before it reaches here — but this is the layer that must not assume that,
  // and the early return also narrows `viewer` for everything below.
  if (!viewer) return forbiddenJson()
  if (!viewer.isAdmin) {
    return Response.json((data || []).filter((p) => viewer.grantedProjectIds.includes(p.id)))
  }

  return Response.json(data || [])
}
