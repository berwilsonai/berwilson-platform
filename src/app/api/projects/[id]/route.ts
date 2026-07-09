import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesUpdate } from '@/lib/supabase/types'
import { getViewer, canAccessProject, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'
import { isMapIconType, MAP_GEOMETRY_MAX_BYTES } from '@/lib/map/constants'

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

// Inline quick-edit of capture fields (bid due date, P-win, bid decision)
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin && !(await canAccessProject(viewer, id))) return forbiddenJson()

  const body = await request.json().catch(() => ({}))

  // Map columns land via migration 20260709000001; extend the generated type
  // locally until gen-types is re-run.
  const update: TablesUpdate<'projects'> & {
    latitude?: number | null
    longitude?: number | null
    map_icon?: string | null
    map_geometry?: unknown
  } = {}

  if ('bid_due_date' in body) {
    const v = body.bid_due_date
    update.bid_due_date = v ? String(v) : null
  }

  if ('win_probability' in body) {
    const v = body.win_probability
    if (v === null || v === '') {
      update.win_probability = null
    } else {
      const n = Math.round(Number(v))
      if (isNaN(n) || n < 0 || n > 100) {
        return Response.json({ error: 'win_probability must be 0–100' }, { status: 400 })
      }
      update.win_probability = n
    }
  }

  if ('bid_decision' in body) {
    const v = body.bid_decision
    if (v !== 'undecided' && v !== 'pursue' && v !== 'no_bid') {
      return Response.json({ error: 'invalid bid_decision' }, { status: 400 })
    }
    update.bid_decision = v
  }

  // Map placement fields (/map view) — admin-only
  const MAP_FIELDS = ['latitude', 'longitude', 'map_icon', 'map_geometry'] as const
  const touchesMap = MAP_FIELDS.some((f) => f in body)
  if (touchesMap) {
    if (viewer && !viewer.isAdmin) return forbiddenJson('Only admins can edit map placement')

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
  const returning = touchesMap
    ? 'id, bid_due_date, win_probability, bid_decision, latitude, longitude, map_icon, map_geometry'
    : 'id, bid_due_date, win_probability, bid_decision'

  const { data, error } = await supabase
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
  if (viewer && !viewer.isAdmin) return forbiddenJson('Only admins can delete projects')
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
