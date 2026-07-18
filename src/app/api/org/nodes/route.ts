import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { orgNodeKind, orgEntityType } from '@/lib/utils/org'

// Org structure nodes (arms / management / divisions / SPVs).
// Admin-only by default-deny: /api/org is deliberately NOT in any
// permissions.ts allowlist — the middleware 403s every non-admin role. The
// chart itself is read by the /company/structure server page, so there is no
// read API to open up.

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: {
    parent_id?: string | null
    kind?: string
    name?: string
    vertical?: string
    entity_type?: string
    location?: string
    note?: string
    sort_order?: number
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = body.name?.trim()
  if (!name) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }
  const kind = orgNodeKind(body.kind)

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('org_nodes')
    .insert({
      parent_id: body.parent_id || null,
      kind,
      name,
      vertical: body.vertical?.trim() || null,
      // Divisions/SPVs use the series|standalone vocab; arms carry free text.
      entity_type:
        kind === 'division' || kind === 'spv'
          ? orgEntityType(body.entity_type)
          : body.entity_type?.trim() || null,
      location: body.location?.trim() || null,
      note: body.note?.trim() || null,
      sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ node: data })
}
