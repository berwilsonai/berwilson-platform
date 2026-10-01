import os from 'os'
import path from 'path'
import { getArchive, parseTileCoords, serveTile } from '@/lib/map/pmtiles'

// Serves individual vector tiles composited from two self-hosted Protomaps
// archives: a small whole-world overview (zoom 0-7) and the full-detail
// regions archive (US + Tonga + Albania, zoom 0-15). Low zooms come from the
// world archive so continents render everywhere; zoom 8+ comes from the
// regions archive (blank outside coverage — deliberate, see setup-map-data.sh).
// Both files are multi-hundred-MB/GB and live OUTSIDE the app dir (survive the
// deploy rsync --delete). Archive opening/caching is shared with the rail
// route — src/lib/map/pmtiles.ts.
// Auth is the middleware (admin-only: /api/map is not in ROLE_API_PREFIXES).

const REGION_PATH =
  process.env.MAP_PMTILES_PATH || path.join(os.homedir(), 'berwilson-data/maps/us.pmtiles')
const WORLD_PATH =
  process.env.MAP_WORLD_PMTILES_PATH || path.join(os.homedir(), 'berwilson-data/maps/world.pmtiles')

// Highest zoom present in the world overview extract (--maxzoom=7).
const WORLD_MAX_ZOOM = 7
const MAX_ZOOM = 15

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params
  const coords = parseTileCoords(z, x, y, MAX_ZOOM)
  if (!coords) {
    return Response.json({ error: 'invalid tile coordinates' }, { status: 400 })
  }

  // World overview owns the low zooms (full-planet coverage); the regions
  // archive owns the detail zooms. If the world archive isn't installed yet,
  // low zooms degrade to the regions archive (regions-only, like before).
  const archive =
    coords.z <= WORLD_MAX_ZOOM
      ? ((await getArchive(WORLD_PATH)) ?? (await getArchive(REGION_PATH)))
      : await getArchive(REGION_PATH)

  if (!archive) {
    return Response.json(
      { error: 'Basemap not installed — run scripts/setup-map-data.sh (see deploy/README.md)' },
      { status: 503 }
    )
  }

  return serveTile(archive, coords)
}
