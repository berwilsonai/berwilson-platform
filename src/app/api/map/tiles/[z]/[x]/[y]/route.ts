import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { PMTiles, type RangeResponse, type Source } from 'pmtiles'

// Serves individual vector tiles composited from two self-hosted Protomaps
// archives: a small whole-world overview (zoom 0-7) and the full-detail
// regions archive (US + Tonga + Albania, zoom 0-15). Low zooms come from the
// world archive so continents render everywhere; zoom 8+ comes from the
// regions archive (blank outside coverage — deliberate, see setup-map-data.sh).
// Both files are multi-hundred-MB/GB and live OUTSIDE the app dir (survive the
// deploy rsync --delete). Archives are reopened automatically when replaced on
// disk (mtime/size check per request) — no service restart after a re-extract.
// Auth is the middleware (admin-only: /api/map is not in ROLE_API_PREFIXES).

const REGION_PATH =
  process.env.MAP_PMTILES_PATH || path.join(os.homedir(), 'berwilson-data/maps/us.pmtiles')
const WORLD_PATH =
  process.env.MAP_WORLD_PMTILES_PATH || path.join(os.homedir(), 'berwilson-data/maps/world.pmtiles')

// Highest zoom present in the world overview extract (--maxzoom=7).
const WORLD_MAX_ZOOM = 7
const MAX_ZOOM = 15

/** pmtiles Source backed by an open file handle (byte-range reads). */
class FileHandleSource implements Source {
  constructor(
    private handle: fs.FileHandle,
    private key: string
  ) {}
  getKey() {
    return this.key
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await this.handle.read(buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) }
  }
}

interface CachedArchive {
  pmtiles: PMTiles
  handle: fs.FileHandle
  mtimeMs: number
  size: number
}

const archives = new Map<string, CachedArchive>()

/** Open (or reuse) an archive; reopen if the file on disk was replaced. */
async function getArchive(filePath: string): Promise<PMTiles | null> {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    return null
  }
  const cached = archives.get(filePath)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.pmtiles
  }
  if (cached) {
    archives.delete(filePath)
    cached.handle.close().catch(() => {})
  }
  const handle = await fs.open(filePath, 'r')
  const source = new FileHandleSource(handle, `${filePath}@${stat.mtimeMs}:${stat.size}`)
  const entry: CachedArchive = {
    pmtiles: new PMTiles(source),
    handle,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  }
  archives.set(filePath, entry)
  return entry.pmtiles
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params
  const zi = Number(z)
  const xi = Number(x)
  const yi = Number(y)
  if (
    !Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi) ||
    zi < 0 || zi > MAX_ZOOM || xi < 0 || yi < 0 || xi >= 2 ** zi || yi >= 2 ** zi
  ) {
    return Response.json({ error: 'invalid tile coordinates' }, { status: 400 })
  }

  // World overview owns the low zooms (full-planet coverage); the regions
  // archive owns the detail zooms. If the world archive isn't installed yet,
  // low zooms degrade to the regions archive (regions-only, like before).
  const archive =
    zi <= WORLD_MAX_ZOOM
      ? (await getArchive(WORLD_PATH)) ?? (await getArchive(REGION_PATH))
      : await getArchive(REGION_PATH)

  if (!archive) {
    return Response.json(
      { error: 'Basemap not installed — run scripts/setup-map-data.sh (see deploy/README.md)' },
      { status: 503 }
    )
  }

  let tile: RangeResponse | undefined
  try {
    tile = await archive.getZxy(zi, xi, yi)
  } catch {
    // A truncated/corrupt archive (e.g. mid-copy) — treat as unavailable.
    return Response.json({ error: 'Basemap archive unreadable' }, { status: 503 })
  }

  if (!tile || tile.data.byteLength === 0) {
    // No tile here (outside extract coverage) — empty, not an error.
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'private, max-age=86400' },
    })
  }

  return new Response(Buffer.from(tile.data), {
    status: 200,
    headers: {
      'Content-Type': 'application/x-protobuf',
      'Cache-Control': 'private, max-age=86400',
    },
  })
}
