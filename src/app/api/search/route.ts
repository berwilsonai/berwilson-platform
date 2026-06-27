import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  oppType,
  oppStatus,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_STATUS_LABELS,
} from '@/lib/utils/opportunities'

export type SearchResult = {
  id: string
  type: 'project' | 'opportunity' | 'contact' | 'vendor'
  title: string
  subtitle: string | null
  href: string
}

/**
 * GET /api/search?q=… — lightweight cross-entity name search for the command palette.
 * Matches projects, contacts (parties), and vendors (entities) by name via ilike.
 * Auth is enforced by middleware; uses the admin client like the rest of the app.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return Response.json({ results: [] })

  const pattern = `%${q}%`
  const supabase = createAdminClient()

  const [{ data: projects }, { data: opportunities }, { data: parties }, { data: entities }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, sector, stage')
      .ilike('name', pattern)
      .order('updated_at', { ascending: false })
      .limit(6),
    supabase
      .from('opportunities')
      .select('id, name, opp_type, status')
      .ilike('name', pattern)
      .order('updated_at', { ascending: false })
      .limit(6),
    supabase
      .from('parties')
      .select('id, full_name, title, company, is_organization')
      .ilike('full_name', pattern)
      .limit(6),
    supabase
      .from('entities')
      .select('id, name, category, headquarters')
      .ilike('name', pattern)
      .limit(6),
  ])

  const results: SearchResult[] = []

  for (const p of projects ?? []) {
    results.push({
      id: p.id,
      type: 'project',
      title: p.name,
      subtitle: [p.stage, p.sector].filter(Boolean).join(' · ') || null,
      href: `/projects/${p.id}`,
    })
  }
  for (const o of opportunities ?? []) {
    results.push({
      id: o.id,
      type: 'opportunity',
      title: o.name,
      subtitle: [
        OPPORTUNITY_TYPE_LABELS[oppType(o.opp_type)],
        OPPORTUNITY_STATUS_LABELS[oppStatus(o.status)],
      ].filter(Boolean).join(' · ') || null,
      href: `/opportunities/${o.id}`,
    })
  }
  for (const p of parties ?? []) {
    results.push({
      id: p.id,
      type: 'contact',
      title: p.full_name,
      subtitle: [p.title, p.company].filter(Boolean).join(' · ') || null,
      href: `/contacts/${p.id}`,
    })
  }
  for (const e of entities ?? []) {
    results.push({
      id: e.id,
      type: 'vendor',
      title: e.name,
      subtitle: [e.category, e.headquarters].filter(Boolean).join(' · ') || null,
      href: `/vendors/${e.id}`,
    })
  }

  return Response.json({ results })
}
