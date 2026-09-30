import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { leadsDbAs } from '@/lib/leads/db'
import { invalidateCategoryCache, listCategories } from '@/lib/leads/categories'
import { normalizeCategoryPatch } from '@/lib/leads/category-input'

/**
 * The lead routing registry — GET the taxonomy, POST a new line of business.
 *
 * Admin-only by default-deny: /api/settings/* is in no ROLE_API_PREFIXES
 * allowlist, so middleware already blocks every other role. The in-route guard
 * is belt-and-braces, matching the rest of the module.
 *
 * ⚠ `matchesPrefix` is NOT method-aware (§12) — allowlisting a read path would
 * grant every mutation under it. This route carries its own guard regardless of
 * what any allowlist later says.
 */
export async function GET() {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ categories: await listCategories() })
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const parsed = normalizeCategoryPatch(body, { requireKey: true })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // Placed at the end by default rather than at 100 alongside everything else:
  // a new lane the reader just created should appear where they expect it, and
  // `unknown` sorts at 990 so it stays last.
  if (parsed.value.sort_order === undefined) {
    const existing = await listCategories()
    const highest = Math.max(0, ...existing.filter((c) => !c.system).map((c) => c.sort_order))
    parsed.value.sort_order = highest + 10
  }

  const { data, error } = await leadsDbAs({ id: viewer.authUserId, email: viewer.email })
    .from('lead_categories')
    .insert(parsed.value)
    .select('*')
    .maybeSingle()

  if (error) {
    // 23505 is the unique index on `key` — by far the likeliest failure, and
    // worth saying in words rather than handing back a Postgres code.
    const message = /duplicate key|23505/.test(error.message)
      ? `There is already a line of business with the key "${parsed.value.key}".`
      : error.message
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // The registry is cached for 60s; a creation the reader is watching for must
  // not wait that out.
  invalidateCategoryCache()
  return NextResponse.json({ category: data })
}
