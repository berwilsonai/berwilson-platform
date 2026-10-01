import os from 'os'
import path from 'path'
import { getArchive, parseTileCoords, serveTile } from '@/lib/map/pmtiles'

// Vector tiles for the North American Rail Network (BTS/NTAD, FRA-sourced),
// including the STRACNET flag DoD uses to designate strategic rail corridors.
// Built by scripts/setup-rail-data.sh into its own archive, alongside the
// basemap and outside the app dir for the same reason (survives the deploy).
// Separate from the basemap deliberately: the rail data is refreshed on BTS's
// annual cadence, the basemap on Protomaps' daily one, and a rail update must
// not mean re-extracting 20GB of basemap.
// Auth is the middleware (admin-only: /api/map is not in ROLE_API_PREFIXES).

const RAIL_PATH =
  process.env.MAP_RAIL_PMTILES_PATH || path.join(os.homedir(), 'berwilson-data/maps/rail.pmtiles')

// Matches --maximum-zoom in the build script. MapLibre overzooms past this,
// which is right for lines: rail geometry is captured at ~1:100,000 and has no
// more detail to give at parcel zoom.
const MAX_ZOOM = 12

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params
  const coords = parseTileCoords(z, x, y, MAX_ZOOM)
  if (!coords) {
    return Response.json({ error: 'invalid tile coordinates' }, { status: 400 })
  }

  const archive = await getArchive(RAIL_PATH)
  if (!archive) {
    // Not installed is not an error the map should shout about — the rail
    // toggle simply draws nothing. 204 keeps it out of MapLibre's error path
    // (a 503 there trips the "basemap missing" notice, which would be a lie).
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'private, max-age=60' },
    })
  }

  return serveTile(archive, coords)
}
