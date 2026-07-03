import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { OBJECTIVE_BUCKETS, type ObjectiveBucket } from '@/lib/utils/objectives'

interface ReorderItem {
  id: string
  bucket: ObjectiveBucket
  sort_order: number
}

/**
 * POST — persist a drag-and-drop result. The client sends the full new
 * (bucket, sort_order) for every objective whose position changed — the board
 * holds at most a couple dozen rows, so per-row updates are fine.
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const items: ReorderItem[] = Array.isArray(body?.items) ? body.items : []

  if (items.length === 0) {
    return Response.json({ error: 'items is required' }, { status: 400 })
  }
  for (const item of items) {
    if (
      typeof item?.id !== 'string' ||
      typeof item?.sort_order !== 'number' ||
      !OBJECTIVE_BUCKETS.includes(item?.bucket)
    ) {
      return Response.json({ error: 'invalid reorder item' }, { status: 400 })
    }
  }

  const supabase = createAdminClient()
  const results = await Promise.all(
    items.map((item) =>
      supabase
        .from('objectives')
        .update({ bucket: item.bucket, sort_order: item.sort_order })
        .eq('id', item.id),
    ),
  )

  const failed = results.find((r) => r.error)
  if (failed?.error) {
    console.error('Reorder objectives failed:', failed.error)
    return Response.json({ error: failed.error.message }, { status: 500 })
  }
  return Response.json({ reordered: items.length })
}
