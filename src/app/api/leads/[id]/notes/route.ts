/**
 * A lead's activity feed.
 *
 * Entries are written by the sweep's apply phase when later mail lands on a
 * lead's thread. Without somewhere to read them the refresh happens invisibly,
 * and a lead that has moved on looks identical to one nobody has touched.
 *
 * Read-only: notes are written by the pipeline, never by hand, so there is no
 * POST here. Admin-only by default-deny, like the rest of /api/leads — it is in
 * no permissions.ts allowlist.
 */

import { NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { leadsDb, type LeadNote } from '@/lib/leads/db'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { data, error } = await leadsDb()
    .from('lead_notes')
    .select('id, lead_id, body, author, created_at')
    .eq('lead_id', id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: (data ?? []) as LeadNote[] })
}
