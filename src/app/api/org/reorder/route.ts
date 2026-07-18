import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { ORG_TIERS, type OrgTier } from '@/lib/utils/org'

// Admin-only by default-deny (see api/org/nodes/route.ts).

interface NodeItem {
  id: string
  sort_order: number
}

interface PersonItem {
  id: string
  sort_order: number
  tier?: OrgTier // present on roster drags so leadership↔director moves persist
}

/**
 * POST — persist a drag-and-drop result. The client sends the full new
 * sort_order for every row whose position changed — the chart holds a few
 * dozen rows at most, so per-row updates are fine (objectives precedent).
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: { nodes?: NodeItem[]; people?: PersonItem[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const nodes: NodeItem[] = Array.isArray(body?.nodes) ? body.nodes : []
  const people: PersonItem[] = Array.isArray(body?.people) ? body.people : []

  if (nodes.length === 0 && people.length === 0) {
    return Response.json({ error: 'nodes or people is required' }, { status: 400 })
  }
  for (const item of nodes) {
    if (typeof item?.id !== 'string' || typeof item?.sort_order !== 'number') {
      return Response.json({ error: 'invalid node reorder item' }, { status: 400 })
    }
  }
  for (const item of people) {
    if (
      typeof item?.id !== 'string' ||
      typeof item?.sort_order !== 'number' ||
      (item.tier !== undefined && !ORG_TIERS.includes(item.tier))
    ) {
      return Response.json({ error: 'invalid person reorder item' }, { status: 400 })
    }
  }

  const supabase = createAdminClient()
  const results = await Promise.all([
    ...nodes.map((item) =>
      supabase.from('org_nodes').update({ sort_order: item.sort_order }).eq('id', item.id),
    ),
    ...people.map((item) =>
      supabase
        .from('org_people')
        .update(
          item.tier !== undefined
            ? { sort_order: item.sort_order, tier: item.tier }
            : { sort_order: item.sort_order },
        )
        .eq('id', item.id),
    ),
  ])

  const failed = results.find((r) => r.error)
  if (failed?.error) {
    console.error('Reorder org structure failed:', failed.error)
    return Response.json({ error: failed.error.message }, { status: 500 })
  }
  return Response.json({ reordered: nodes.length + people.length })
}
