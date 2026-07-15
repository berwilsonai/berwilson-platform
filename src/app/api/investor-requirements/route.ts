import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedInvestorSnapshot } from '@/lib/ai/embeddings'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { requirementCategory, requirementStatus } from '@/lib/utils/investors'

// Investor documentation requirements (lender checklists).
// Admin-only by default-deny: this prefix is deliberately NOT in any
// permissions.ts allowlist — the middleware 403s every non-admin role.

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: {
    investor_id?: string
    project_id?: string | null
    category?: string
    item?: string
    status?: string
    evidence_doc_id?: string | null
    notes?: string
    sort_order?: number
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const item = body.item?.trim()
  if (!body.investor_id || !item) {
    return Response.json({ error: 'investor_id and item are required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('investor_requirements')
    .insert({
      investor_id: body.investor_id,
      project_id: body.project_id || null,
      category: requirementCategory(body.category),
      item,
      status: requirementStatus(body.status),
      evidence_doc_id: body.evidence_doc_id || null,
      notes: body.notes?.trim() || null,
      sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Fold the checklist into the searchable snapshot (skips pre-migration)
  embedInvestorSnapshot(body.investor_id).catch(console.error)

  return Response.json({ requirement: data })
}
