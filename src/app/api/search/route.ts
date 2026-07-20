import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  oppType,
  oppStatus,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_STATUS_LABELS,
} from '@/lib/utils/opportunities'
import {
  investorStage,
  investorType,
  INVESTOR_STAGE_LABELS,
  INVESTOR_TYPE_LABELS,
} from '@/lib/utils/investors'
import { OBJECTIVE_BUCKET_LABELS, type ObjectiveBucket } from '@/lib/utils/objectives'

export type SearchResult = {
  id: string
  type: 'project' | 'opportunity' | 'contact' | 'vendor' | 'task' | 'investor' | 'objective' | 'document'
  title: string
  subtitle: string | null
  href: string
}

/**
 * GET /api/search?q=… — lightweight cross-entity name search for the command palette.
 * Covers every record area: projects, opportunities, contacts (parties), vendors
 * (entities), tasks, investors, objectives, and documents — all by name via ilike.
 * Auth is enforced by middleware; uses the admin client like the rest of the app.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return Response.json({ results: [] })

  const pattern = `%${q}%`
  const supabase = createAdminClient()

  const [
    { data: projects },
    { data: opportunities },
    { data: parties },
    { data: entities },
    { data: tasks },
    { data: investors },
    { data: objectives },
    { data: documents },
  ] = await Promise.all([
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
    supabase
      .from('tasks')
      .select('id, title, status, assignee:team_members!tasks_assignee_id_fkey(name)')
      .ilike('title', pattern)
      .order('updated_at', { ascending: false })
      .limit(6),
    supabase
      .from('investors')
      .select('id, name, stage, investor_type')
      .ilike('name', pattern)
      .order('updated_at', { ascending: false })
      .limit(6),
    supabase
      .from('objectives')
      .select('id, title, bucket')
      .eq('status', 'active')
      .ilike('title', pattern)
      .limit(6),
    supabase
      .from('documents')
      .select('id, file_name, doc_type, project_id, is_company, entity_id, project:projects(name)')
      .ilike('file_name', pattern)
      .order('uploaded_at', { ascending: false })
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
  for (const t of tasks ?? []) {
    results.push({
      id: t.id,
      type: 'task',
      title: t.title,
      subtitle: [t.assignee?.name, t.status === 'done' ? 'Done' : 'Open'].filter(Boolean).join(' · ') || null,
      href: `/tasks?task=${t.id}`,
    })
  }
  for (const i of investors ?? []) {
    results.push({
      id: i.id,
      type: 'investor',
      title: i.name,
      subtitle: [
        INVESTOR_STAGE_LABELS[investorStage(i.stage)],
        INVESTOR_TYPE_LABELS[investorType(i.investor_type)],
      ].filter(Boolean).join(' · ') || null,
      href: `/investors/${i.id}`,
    })
  }
  for (const o of objectives ?? []) {
    results.push({
      id: o.id,
      type: 'objective',
      title: o.title,
      subtitle: OBJECTIVE_BUCKET_LABELS[o.bucket as ObjectiveBucket] ?? null,
      href: '/objectives',
    })
  }
  for (const d of documents ?? []) {
    // Link to the surface the document lives on; skip rows with no destination.
    const href = d.project_id
      ? `/projects/${d.project_id}/documents`
      : d.is_company
        ? '/company'
        : d.entity_id
          ? `/vendors/${d.entity_id}`
          : null
    if (!href) continue
    results.push({
      id: d.id,
      type: 'document',
      title: d.file_name,
      subtitle: d.project?.name ?? (d.is_company ? 'Company knowledge base' : d.doc_type),
      href,
    })
  }

  return Response.json({ results })
}
