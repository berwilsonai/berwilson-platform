import { NextResponse, type NextRequest } from 'next/server'

import { getViewer } from '@/lib/auth/viewer'
import { createSavedView, deleteSavedView } from '@/lib/views/saved'

/**
 * Saved views — create and delete.
 *
 * ⚠ ADMIN ONLY, CHECKED HERE AND NOT ONLY IN MIDDLEWARE. §12: a one-table CRUD
 * route is exactly where a record check goes missing — 22 of 61 such handlers
 * had none. There is no parent record to read here, so the guard is the role
 * itself, and it is explicit rather than inherited from a path prefix.
 *
 * ⚠ THE PATH A VIEW BELONGS TO IS ALLOWLISTED. `path` arrives in the body and
 * is written into a row that later becomes an href; accepting an arbitrary
 * string would let a saved "view" point anywhere. Only the list pages that
 * actually render the chips may be named.
 */
const ALLOWED_PATHS = new Set(['/projects', '/opportunities', '/investors'])

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  let body: { path?: unknown; name?: unknown; query?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  const path = typeof body.path === 'string' ? body.path : ''
  const name = typeof body.name === 'string' ? body.name : ''
  const query = typeof body.query === 'string' ? body.query : ''

  if (!ALLOWED_PATHS.has(path)) {
    return NextResponse.json({ error: 'Views cannot be saved for that page.' }, { status: 400 })
  }

  const result = await createSavedView({
    path,
    name,
    query,
    createdBy: viewer.teamMemberName ?? viewer.email ?? null,
  })

  // A refusal is a 400 with its own sentence — never a 500, and never a silent
  // success that leaves the caller to create the duplicate (§12).
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ view: result.view })
}

export async function DELETE(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Which view?' }, { status: 400 })

  const removed = await deleteSavedView(id)
  if (!removed) return NextResponse.json({ error: 'That view is already gone.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
