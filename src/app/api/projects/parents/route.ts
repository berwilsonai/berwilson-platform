import { createAdminClient } from '@/lib/supabase/admin'

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

  return Response.json(data || [])
}
