import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { leadsDb, leadsDbAs } from '@/lib/leads/db'
import { invalidateCategoryCache, listCategories } from '@/lib/leads/categories'
import { normalizeCategoryPatch } from '@/lib/leads/category-input'

/** PATCH one line of business. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const existing = (await listCategories()).find((c) => c.id === id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = normalizeCategoryPatch(body, { requireKey: false })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // A `system` row is one code depends on by key. Its label, rule and tone are
  // fair game; its key and its destination are not — `unknown` mapping to
  // anything but `manual` would hand a one-click Accept to exactly the leads
  // the triage admitted it could not place.
  if (existing.system) {
    if (parsed.value.key !== undefined && parsed.value.key !== existing.key) {
      return NextResponse.json(
        { error: `"${existing.label}" is a built-in lane and cannot be renamed.` },
        { status: 400 }
      )
    }
    delete parsed.value.key
    delete parsed.value.destination
    delete parsed.value.active
  }

  if (Object.keys(parsed.value).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const { data, error } = await leadsDbAs({ id: viewer.authUserId, email: viewer.email })
    .from('lead_categories')
    .update(parsed.value)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    const message = /duplicate key|23505/.test(error.message)
      ? `There is already a line of business with the key "${parsed.value.key}".`
      : error.message
    return NextResponse.json({ error: message }, { status: 400 })
  }

  invalidateCategoryCache()
  return NextResponse.json({ category: data })
}

/**
 * DELETE one line of business — only ever one with no leads.
 *
 * The FK on `leads.route` has no delete rule, so Postgres refuses to delete a
 * category any lead still points at (23503). That is deliberate and is the
 * whole reason `active` exists: closing a lane must not orphan its history, and
 * a lane with work in it is closed, not erased.
 *
 * The count is read first so the refusal can say HOW MANY leads are in the way,
 * rather than returning a foreign-key violation for the reader to decode.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = (await listCategories()).find((c) => c.id === id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (existing.system) {
    return NextResponse.json(
      { error: `"${existing.label}" is a built-in lane and cannot be deleted.` },
      { status: 400 }
    )
  }

  const { count } = await leadsDb()
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('route', existing.key)

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          `${count} lead(s) are still filed under "${existing.label}", so it cannot be deleted — ` +
          'deleting it would erase where they came from. Switch it off instead: it stops receiving ' +
          'new leads and disappears from the model, and the leads it already owns stay readable.',
      },
      { status: 409 }
    )
  }

  const { error } = await leadsDbAs({ id: viewer.authUserId, email: viewer.email })
    .from('lead_categories')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  invalidateCategoryCache()
  return NextResponse.json({ ok: true })
}
