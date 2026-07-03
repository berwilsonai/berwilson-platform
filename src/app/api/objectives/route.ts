import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { OBJECTIVE_BUCKETS, objectiveBucket } from '@/lib/utils/objectives'
import type { TablesInsert } from '@/lib/supabase/types'

const OBJECTIVE_SELECT = '*, owner:team_members(id, name, color)'

/** GET — list objectives (?status=active|archived, default active), bucket-ordered */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') === 'archived' ? 'archived' : 'active'

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('objectives')
    .select(OBJECTIVE_SELECT)
    .eq('status', status)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('List objectives failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ objectives: data })
}

/** POST — create an objective at the bottom of its bucket */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, note, bucket, owner_id, target_date } = body

  if (!title?.trim()) {
    return Response.json({ error: 'title is required' }, { status: 400 })
  }
  if (bucket && !OBJECTIVE_BUCKETS.includes(bucket)) {
    return Response.json({ error: 'invalid bucket' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Append to the bottom of the bucket.
  const targetBucket = objectiveBucket(bucket)
  const { data: last } = await supabase
    .from('objectives')
    .select('sort_order')
    .eq('bucket', targetBucket)
    .eq('status', 'active')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const row: TablesInsert<'objectives'> = {
    title: title.trim(),
    note: note?.trim() || null,
    bucket: targetBucket,
    sort_order: (last?.sort_order ?? -1) + 1,
    owner_id: owner_id || null,
    target_date: target_date || null,
    status: 'active',
  }

  const { data, error } = await supabase
    .from('objectives')
    .insert(row)
    .select(OBJECTIVE_SELECT)
    .single()

  if (error) {
    console.error('Create objective failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ objective: data })
}
