import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getViewer, canAccessProject, forbiddenJson } from '@/lib/auth/viewer'
import { importParcels, parseSchedule } from '@/lib/parcels/import'
import { UTAH_COUNTY_SERVICES } from '@/lib/parcels/agrc'
import { parcelDb } from '@/lib/parcels/queries'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Import a pasted parcel schedule onto a project, optionally pulling geometry
 * from the county's public cadastre.
 *
 * The county lookup reaches the open web. That is acceptable here for the same
 * reason the Enrich Profile buttons are (CLAUDE.md §2): the only thing leaving
 * the machine is a parcel number and a county name, both already public on the
 * exhibit the schedule was typed from. Nothing about the deal goes out, and no
 * runtime surface depends on the call succeeding — a failed lookup still
 * imports the schedule and says why the geometry is missing.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const viewer = await getViewer()
  if (!viewer || (!viewer.isAdmin && !(await canAccessProject(viewer, id)))) return forbiddenJson()

  const body = (await request.json()) as {
    county?: string
    schedule?: string
    existingZone?: string
    requestedZone?: string
    ownerName?: string
    textOnly?: boolean
  }

  const county = (body.county ?? '').trim()
  if (!county || !UTAH_COUNTY_SERVICES[county]) {
    return Response.json({ error: 'A Utah county is required' }, { status: 400 })
  }

  const entries = parseSchedule(body.schedule ?? '')
  if (entries.length === 0) {
    return Response.json(
      { error: 'No parcel rows found. Paste one parcel per line: id, acres, status.' },
      { status: 400 }
    )
  }

  try {
    const result = await importParcels({
      projectId: id,
      county,
      textOnly: body.textOnly === true,
      schedule: entries.map((entry) => ({
        ...entry,
        ownerName: body.ownerName?.trim() || null,
        existingZone: body.existingZone?.trim() || null,
        requestedZone: body.requestedZone?.trim() || null,
      })),
    })
    return Response.json({ result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parcel import failed'
    console.error('[parcels] import failed:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const viewer = await getViewer()
  if (!viewer || (!viewer.isAdmin && !(await canAccessProject(viewer, id)))) return forbiddenJson()

  const parcelRowId = new URL(request.url).searchParams.get('parcel')
  if (!parcelRowId) return Response.json({ error: 'parcel is required' }, { status: 400 })

  // Scoped to the project as well as the row id — a bare id delete would let
  // any project's page remove any other project's parcel.
  const { error } = await parcelDb()
    .from('project_parcels')
    .delete()
    .eq('id', parcelRowId)
    .eq('project_id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
