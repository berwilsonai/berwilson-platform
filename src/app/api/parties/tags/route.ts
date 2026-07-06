import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/parties/tags — every tag currently in use on active contacts,
 * with usage counts. Powers tag autocomplete; the vocabulary is
 * self-maintaining (a tag exists only while a contact carries it).
 */
export async function GET() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('parties')
    .select('tags')
    .eq('status', 'active')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    for (const tag of (row.tags as string[]) ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }

  const tags = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag))

  return NextResponse.json({ tags })
}
