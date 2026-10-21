import { NextRequest, NextResponse } from 'next/server'
import { actorAdminClient, getViewer } from '@/lib/auth/viewer'
import { invalidateContactRoleCache, listContactRoles } from '@/lib/contacts/roles'
import { normalizeRolePatch } from '@/lib/contacts/role-input'

/**
 * The contact-role registry — GET the taxonomy, POST a new role.
 *
 * Admin-only by default-deny: /api/settings/* is in no ROLE_API_PREFIXES
 * allowlist, so middleware already blocks every other role. The in-route guard
 * is belt-and-braces, matching /api/settings/lead-categories.
 *
 * ⚠ `matchesPrefix` is NOT method-aware (§12) — allowlisting a read path would
 * grant every mutation under it. This route carries its own guard regardless.
 */
export async function GET() {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ roles: await listContactRoles() })
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const parsed = normalizeRolePatch(body, { requireKey: true })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // Placed at the end of its GROUP rather than at a global 100, so a role
  // added to Finance & Legal appears in Finance & Legal rather than in a tenth
  // group of its own. sort_order is group-major in tens by design.
  if (parsed.value.sort_order === undefined) {
    const existing = await listContactRoles()
    const inGroup = existing.filter((r) => r.role_group === parsed.value.role_group)
    parsed.value.sort_order =
      inGroup.length > 0
        ? Math.max(...inGroup.map((r) => r.sort_order)) + 1
        : Math.max(0, ...existing.map((r) => r.sort_order)) + 100
  }

  const { data, error } = await (await actorAdminClient())
    .from('contact_roles')
    .insert(parsed.value as { key: string; label: string; role_group: string })
    .select('*')
    .maybeSingle()

  if (error) {
    const message = /duplicate key|23505/.test(error.message)
      ? `There is already a role with the key "${parsed.value.key}".`
      : error.message
    return NextResponse.json({ error: message }, { status: 400 })
  }

  invalidateContactRoleCache()
  return NextResponse.json({ role: data })
}
