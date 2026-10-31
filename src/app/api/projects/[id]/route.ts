import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesUpdate } from '@/lib/supabase/types'
import { getViewer, canAccessProject, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'
import { isMapIconType, MAP_GEOMETRY_MAX_BYTES } from '@/lib/map/constants'
import { coerceInlineValue, isInlineField, INLINE_FIELD_NAMES } from '@/lib/projects/inline-fields'

interface RouteContext {
  params: Promise<{ id: string }>
}

function isValidLineString(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const g = v as { type?: unknown; coordinates?: unknown }
  if (g.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) return false
  return g.coordinates.every(
    (pt) =>
      Array.isArray(pt) &&
      pt.length >= 2 &&
      typeof pt[0] === 'number' && pt[0] >= -180 && pt[0] <= 180 &&
      typeof pt[1] === 'number' && pt[1] >= -90 && pt[1] <= 90
  )
}

/**
 * Edit a project's fields in place.
 *
 * Every field the record page offers on a double-click, plus the map placement
 * block below, which keeps its own hand-written validation because it is
 * admin-only and geometry has nothing in common with the rest.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const viewer = await getViewer()
  if (!viewer || (!viewer.isAdmin && !(await canAccessProject(viewer, id)))) return forbiddenJson()

  const body = await request.json().catch(() => ({}))

  // Map columns land via migration 20260709000001; extend the generated type
  // locally until gen-types is re-run.
  const update: TablesUpdate<'projects'> & {
    latitude?: number | null
    longitude?: number | null
    map_icon?: string | null
    map_geometry?: unknown
  } = {}

  /*
    ⚠ THE WHITELIST IS THE SPEC, NOT A LIST WRITTEN HERE.

    This route hand-rolled three fields — bid_due_date, win_probability and
    the since-removed bid_decision — each with its own `if ('x' in body)` block
    and its own validation. Inline editing on the record page needs twenty-one, and
    twenty-one hand-rolled blocks is where the §12 finding lands: of 61
    one-table route handlers with one write verb, 22 had no record check at
    all, six of them siblings of a seventh that did. The spec in
    `inline-fields.ts` is what the renderer reads too, so a field the UI can
    offer is exactly a field this route accepts — there is no second list to
    forget.

    ⚠ AND `coerceInlineValue` IS THE VALIDATION, so the error the browser shows
    is the same sentence whichever surface wrote. The old win_probability block
    answered "win_probability must be 0–100" — a column name and a range, to a
    reader who had just picked "High" from three words.
  */
  const rejected: string[] = []
  for (const key of Object.keys(body)) {
    if (!isInlineField(key)) continue
    const coerced = coerceInlineValue(key, (body as Record<string, unknown>)[key])
    if (!coerced.ok) {
      rejected.push(coerced.error)
      continue
    }
    // The spec's keys are all real `projects` columns — asserted by
    // `inline-fields.test.ts` against the generated row type, so this cast
    // cannot hide a typo the way `as unknown as` would (§12).
    ;(update as Record<string, unknown>)[key] = coerced.value
  }

  if (rejected.length > 0) {
    return Response.json({ error: rejected.join(' ') }, { status: 400 })
  }

  // Map placement fields (/map view) — admin-only
  const MAP_FIELDS = ['latitude', 'longitude', 'map_icon', 'map_geometry'] as const
  const touchesMap = MAP_FIELDS.some((f) => f in body)
  if (touchesMap) {
    if (!viewer?.isAdmin) return forbiddenJson('Only admins can edit map placement')

    if ('latitude' in body) {
      const v = body.latitude
      if (v === null || v === '') {
        update.latitude = null
      } else {
        const n = Number(v)
        if (isNaN(n) || n < -90 || n > 90) {
          return Response.json({ error: 'latitude must be −90–90' }, { status: 400 })
        }
        update.latitude = n
      }
    }

    if ('longitude' in body) {
      const v = body.longitude
      if (v === null || v === '') {
        update.longitude = null
      } else {
        const n = Number(v)
        if (isNaN(n) || n < -180 || n > 180) {
          return Response.json({ error: 'longitude must be −180–180' }, { status: 400 })
        }
        update.longitude = n
      }
    }

    if ('map_icon' in body) {
      const v = body.map_icon
      if (v !== null && !isMapIconType(v)) {
        return Response.json({ error: 'invalid map_icon' }, { status: 400 })
      }
      update.map_icon = v
    }

    if ('map_geometry' in body) {
      const v = body.map_geometry
      if (v !== null && !isValidLineString(v)) {
        return Response.json({ error: 'map_geometry must be a GeoJSON LineString' }, { status: 400 })
      }
      if (v !== null && JSON.stringify(v).length > MAP_GEOMETRY_MAX_BYTES) {
        return Response.json({ error: 'map_geometry too large' }, { status: 400 })
      }
      update.map_geometry = v
    }
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'no editable fields provided' }, { status: 400 })
  }

  // Only ask for map columns when they were edited, so this route behaves
  // identically for existing callers before the migration is applied.
  /*
    ⚠ IT RETURNS EVERY INLINE FIELD, NOT THE THREE IT USED TO.

    This was a literal three-column list, which was right while the route
    accepted three columns. An inline edit of `location` would have written
    correctly and come back WITHOUT location — and the client reconciles its
    optimistic value against what comes back, so the field would have snapped
    to undefined and rendered empty over a database that held the new value.
    §12: a `.select()` column list is a string, so a column that is missing
    from it breaks its readers and `tsc` sees nothing.
  */
  const inlineColumns = INLINE_FIELD_NAMES.join(', ')
  const returning = touchesMap
    ? `id, ${inlineColumns}, latitude, longitude, map_icon, map_geometry`
    : `id, ${inlineColumns}`

  /*
    ⚠ `actorAdminClient()`, NOT THE REQUEST'S OWN RLS CLIENT.

    §12: a user-initiated mutation on a tracked table goes through this client
    or the activity log says "system" — and a trail whose every row reads
    "system" answers nothing, which is the only question it was added to
    answer. `projects` carries `log_activity()` and is one of the tables
    audited column-by-column, so every edit here is diffed into
    `activity_log.field_changes` and rendered in Change History on the record's
    own Overview.

    It mattered less when this route wrote three capture fields from a board
    overlay. It matters now: twenty-one fields are a double-click away, which
    is exactly when "who changed the value, and from what" becomes the
    question somebody asks. The DELETE below has always used it.

    Authorisation is unchanged — `getViewer()` and `canAccessProject()` above
    are the boundary, as §8 describes, and the admin client is the writer.
  */
  const writer = await actorAdminClient()
  const { data, error } = await writer
    .from('projects')
    // cast: map columns aren't in the generated types until gen-types re-runs
    .update(update as TablesUpdate<'projects'>)
    .eq('id', id)
    .select(returning)
    .single()

  if (error) {
    console.error('Quick-edit failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ project: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson('Only admins can delete projects')
  const supabase = await actorAdminClient()

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
