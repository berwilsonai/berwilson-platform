import { NextRequest, NextResponse } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { getPartyRoles, setPartyRoles } from '@/lib/contacts/roles'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * What a contact is TO US.
 *
 * ⚠ `actorAdminClient()`, not `createAdminClient()`. `party_roles` carries
 * `log_activity()` from the migration that created it, and §12 is explicit:
 * making a table tracked means auditing every write path to it in the SAME
 * change, or the trail reads "system" and answers nothing. Five of the eight
 * routes mutating `parties` were found on the plain client on 10-20; this one
 * was written with the rule in hand.
 *
 * PUT replaces the whole set rather than PATCHing one role, because the editor
 * sends the state of a multi-select and there is no partial update to express.
 * `setPartyRoles` still DIFFS before writing, so adding one role logs one
 * insert rather than six deletes and six inserts.
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  return NextResponse.json({ roles: await getPartyRoles(id) })
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { roles?: unknown }

  if (!Array.isArray(body.roles)) {
    return NextResponse.json({ error: '`roles` must be an array of role keys.' }, { status: 400 })
  }
  const keys = body.roles.filter((k): k is string => typeof k === 'string')

  const db = await actorAdminClient()

  // The contact must exist. A PATCH-shaped route carries only an id, which is
  // exactly why the parent read gets skipped (§12) — without it this would
  // happily write roles against a uuid naming nothing.
  const { data: party, error: lookupError } = await db
    .from('parties')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 })
  if (!party) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  try {
    const result = await setPartyRoles(db, id, keys)
    return NextResponse.json({ roles: await getPartyRoles(id), ...result })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to save roles' },
      { status: 400 }
    )
  }
}
