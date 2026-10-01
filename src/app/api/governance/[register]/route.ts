import { NextRequest, NextResponse } from 'next/server'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { govDb, govDbAs } from '@/lib/governance/db'
import {
  explainDbError,
  getRegister,
  normalizeRegisterPayload,
  type RegisterSpec,
} from '@/lib/governance/registers'

/**
 * One route for every governance register — GET the rows, POST a new one.
 *
 * ⚠ ADMIN-ONLY BY DEFAULT-DENY *AND* BY ITS OWN GUARD. /api/governance/* is in
 * no ROLE_API_PREFIXES allowlist, so middleware already blocks every other role.
 * The in-route check stays because `matchesPrefix` is NOT method-aware (§12):
 * allowlisting a read path here later would grant every mutation under it.
 *
 * ⚠ THE REGISTER NAME IS RESOLVED THROUGH A FIXED MAP, never interpolated into
 * a table name. A name that is not in REGISTERS 404s before any client is built,
 * so this route cannot be pointed at auth.users or activity_log.
 */

async function resolve(register: string): Promise<RegisterSpec | null> {
  return getRegister(register)
}

/** Copy the related record's display name onto the row (see RegisterSpec.snapshots). */
async function applySnapshots(spec: RegisterSpec, value: Record<string, unknown>): Promise<void> {
  if (!spec.snapshots) return
  const db = govDb()
  for (const snap of spec.snapshots) {
    if (!(snap.from in value)) continue
    const id = value[snap.from]
    if (!id || typeof id !== 'string') {
      // Cleared the link — clear the snapshot with it, or the row keeps naming
      // an entity it is no longer attached to.
      value[snap.into] = null
      continue
    }
    const { data } = await db.from(snap.table).select(snap.column).eq('id', id).maybeSingle()
    const name = (data as Record<string, unknown> | null)?.[snap.column]
    value[snap.into] = typeof name === 'string' ? name : null
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ register: string }> }) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const { register } = await params
  const spec = await resolve(register)
  if (!spec) return NextResponse.json({ error: `Unknown register "${register}"` }, { status: 404 })

  const { searchParams } = new URL(request.url)
  let query = govDb()
    .from(spec.table)
    .select('*')
    .order(spec.orderBy.column, { ascending: spec.orderBy.ascending, nullsFirst: false })
    .limit(1000)

  // A child register is almost always read for one parent.
  const parent = searchParams.get('personnel_id') ?? searchParams.get('policy_id')
  if (parent) {
    const column = searchParams.get('personnel_id') ? 'personnel_id' : 'policy_id'
    if (column in spec.fields) query = query.eq(column, parent)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: explainDbError(error.message, error.code) }, { status: 500 })
  }
  return NextResponse.json({ rows: data ?? [] })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ register: string }> }) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const { register } = await params
  const spec = await resolve(register)
  if (!spec) return NextResponse.json({ error: `Unknown register "${register}"` }, { status: 404 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const parsed = normalizeRegisterPayload(spec, body, {
    // The viewer's own name, not anything the client sent. An HR note whose
    // author the reader can set is not evidence of anything.
    author: viewer.teamMemberName ?? viewer.email ?? null,
  })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  await applySnapshots(spec, parsed.value)

  const { data, error } = await govDbAs({ id: viewer.authUserId, email: viewer.email })
    .from(spec.table)
    .insert(parsed.value)
    .select('*')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: explainDbError(error.message, error.code) }, { status: 400 })
  }
  return NextResponse.json({ row: data })
}
