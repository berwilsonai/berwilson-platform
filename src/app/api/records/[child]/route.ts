import { NextRequest, NextResponse } from 'next/server'

import { getViewer } from '@/lib/auth/viewer'
import { guardCreateScope } from '@/lib/records/children-access'
import { applyStamp, getChild } from '@/lib/records/children'
import { normalizePayload } from '@/lib/registry/fields'
import { createUntypedAdminClient } from '@/lib/supabase/admin'

/**
 * POST one new child row of a project or an opportunity.
 *
 * One route for milestones, diligence, financing, compliance, players and
 * entity links — see src/lib/records/children.ts for why there is one of these
 * rather than six, and for the four ways the six it replaced had drifted.
 *
 * ⚠ THE ACCESS CHECK IS THE REASON THIS FILE EXISTS, so it is unconditional and
 * comes before the write. It cannot be forgotten here the way it was in six
 * route files, because there is only one place left to forget it.
 *
 * ⚠ THE CLIENT IS UNTYPED AND THAT IS NOT LAZINESS. `spec.table` is a value, so
 * the generated client cannot infer a row type for it; the TYPES still come
 * from the schema wherever a caller reads these tables. Same trade-off, for the
 * same reason, as src/lib/governance/db.ts.
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ child: string }> }
) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { child } = await params
  const spec = getChild(child)
  if (!spec) return NextResponse.json({ error: `Unknown record child "${child}"` }, { status: 404 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const guarded = await guardCreateScope(viewer, spec, body)
  if (!guarded.ok) return guarded.response

  const parsed = normalizePayload(spec, body, { partial: false })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const value: Record<string, unknown> = { ...guarded.value }
  // Defaults first, so an explicit value in the body wins over them.
  for (const [column, fallback] of Object.entries(spec.defaults ?? {})) {
    value[column] = fallback
  }
  Object.assign(value, parsed.value)
  applyStamp(spec, body, value)

  // Stamped with the acting user, never a bare admin client: a human adding a
  // player is a user-initiated mutation on a tracked table, and the activity
  // log said "system" for two of the routes this replaces (§12).
  const admin = createUntypedAdminClient({ id: viewer.authUserId, email: viewer.email })
  const { data, error } = await admin
    .from(spec.table)
    .insert(value)
    .select(spec.select ?? '*')
    .maybeSingle()

  if (error) {
    if (error.code === '23505' && spec.conflict) {
      return NextResponse.json({ error: spec.conflict }, { status: 409 })
    }
    // A CHECK the edge cannot see — a range, a positivity rule, the
    // exactly-one-parent constraint. Postgres names the constraint in
    // `error.message`; the spec says what it means to a reader. Unmapped, it
    // falls through to the 500 below, which is the honest answer for a
    // constraint nobody has written words for yet.
    if (error.code === '23514' && spec.checks) {
      for (const [constraint, message] of Object.entries(spec.checks)) {
        if (error.message.includes(constraint)) {
          return NextResponse.json({ error: message }, { status: 400 })
        }
      }
    }
    console.error(`[records/${child}] insert failed:`, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ row: data }, { status: 201 })
}
