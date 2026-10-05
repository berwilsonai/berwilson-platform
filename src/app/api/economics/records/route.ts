/**
 * GET /api/economics/records — the deals a scratch calc can be saved onto.
 *
 * ⚠ CONFIDENTIAL PROJECTS ARE DROPPED AND THE COUNT IS REPORTED. A picker
 * trimmed from 14 to 13 and presented as 13 is confidently wrong; the caller is
 * told some are protected (CLAUDE.md §12, 09-30).
 */

import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { dropHidden, hiddenProjectIds } from '@/lib/security/confidential'

export async function GET() {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const db = createAdminClient()
  const [projects, opportunities] = await Promise.all([
    db.from('projects').select('id,name,stage').order('name').limit(500),
    db.from('opportunities').select('id,name').order('name').limit(500),
  ])
  if (projects.error || opportunities.error) {
    return Response.json(
      { error: projects.error?.message ?? opportunities.error?.message },
      { status: 500 }
    )
  }

  const hidden = await hiddenProjectIds(viewer.authUserId)
  const rows = projects.data ?? []
  // Filtered in memory: a PostgREST `not.in` needs a bracketed list built by
  // hand and is a syntax error on an empty one.
  const visible = dropHidden(rows, (p) => p.id, hidden)
  const withheld = rows.length - visible.length

  return Response.json({
    projects: visible.map((p) => ({ id: p.id, name: p.name, kind: 'project' as const })),
    opportunities: (opportunities.data ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      kind: 'opportunity' as const,
    })),
    withheld_protected: withheld,
  })
}
