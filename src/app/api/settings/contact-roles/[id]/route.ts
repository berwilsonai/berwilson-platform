import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { actorAdminClient, getViewer } from '@/lib/auth/viewer'
import { invalidateContactRoleCache, listContactRoles } from '@/lib/contacts/roles'
import { normalizeRolePatch } from '@/lib/contacts/role-input'

/** PATCH one role. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const existing = (await listContactRoles()).find((r) => r.id === id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = normalizeRolePatch(body, { requireKey: false })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // A `system` row is one code depends on by key. Its label and hint are fair
  // game; its key is not, and neither is switching it off.
  if (existing.system) {
    if (parsed.value.key !== undefined && parsed.value.key !== existing.key) {
      return NextResponse.json(
        { error: `"${existing.label}" is a built-in role and cannot be renamed.` },
        { status: 400 }
      )
    }
    delete parsed.value.key
    delete parsed.value.active
  }

  if (Object.keys(parsed.value).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  // Renaming the KEY cascades: both FKs are `on update cascade`, so every
  // party_roles row and every project_players.role_key follows it in the same
  // statement. That is the contract — and it is why the key is not editable on
  // a system row, whose key is also written in source.
  const { data, error } = await (await actorAdminClient())
    .from('contact_roles')
    .update(parsed.value)
    .eq('id', id)
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

/**
 * DELETE one role — only ever one nobody holds.
 *
 * Neither FK has a delete rule, so Postgres refuses to delete a role any
 * contact or any project player still carries (23503). That is deliberate and
 * is the whole reason `active` exists: retiring a role must not erase the
 * history of who was one.
 *
 * Both counts are read first so the refusal can say how many are in the way,
 * rather than handing back a foreign-key violation for the reader to decode.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = (await listContactRoles()).find((r) => r.id === id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (existing.system) {
    return NextResponse.json(
      { error: `"${existing.label}" is a built-in role and cannot be deleted.` },
      { status: 400 }
    )
  }

  const db = createAdminClient()
  const [{ count: contacts }, { count: players }] = await Promise.all([
    db.from('party_roles').select('id', { count: 'exact', head: true }).eq('role_key', existing.key),
    db
      .from('project_players')
      .select('id', { count: 'exact', head: true })
      .eq('role_key', existing.key),
  ])

  const held = (contacts ?? 0) + (players ?? 0)
  if (held > 0) {
    const parts = [
      (contacts ?? 0) > 0 ? `${contacts} contact${contacts === 1 ? '' : 's'}` : null,
      (players ?? 0) > 0 ? `${players} project player${players === 1 ? '' : 's'}` : null,
    ].filter(Boolean)
    return NextResponse.json(
      {
        error:
          `${parts.join(' and ')} still hold "${existing.label}", so it cannot be deleted — ` +
          'deleting it would erase what they are. Switch it off instead: it stops being offered ' +
          'and disappears from the model, and whoever holds it stays labelled.',
      },
      { status: 409 }
    )
  }

  const { error } = await (await actorAdminClient()).from('contact_roles').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  invalidateContactRoleCache()
  return NextResponse.json({ ok: true })
}
