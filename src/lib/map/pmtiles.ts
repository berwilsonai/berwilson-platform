import { promises as fs } from 'fs'
import { PMTiles, type RangeResponse, type Source } from 'pmtiles'

// Shared reader for the self-hosted PMTiles archives behind /map — the
// basemap (world overview + detail regions) and the rail network. One cache
// for all of them: the archives are multi-hundred-MB/GB files opened once and
// read by byte range, and a second copy of this logic per route is exactly the
// fork §12 warns about. Archives are reopened automatically when replaced on
// disk (mtime/size check per request) — no service restart after a re-extract.

/**
 * pmtiles Source backed by an open file handle (byte-range reads).
 *
 * Plain fields rather than TypeScript parameter properties: node's strip-only
 * type stripping — which is how every script in this repo runs TS — refuses
 * them outright, and a shared lib nothing can load from a script is a shared
 * lib nothing can verify.
 */
class FileHandleSource implements Source {
  private handle: fs.FileHandle
  private key: string

  constructor(handle: fs.FileHandle, key: string) {
    this.handle = handle
    this.key = key
  }

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
export async function getArchive(filePath: string): Promise<PMTiles | null> {
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

export interface TileCoords {
  z: number
  x: number
  y: number
}

/** Parse + bounds-check a {z}/{x}/{y} route param triple. */
export function parseTileCoords(
  z: string,
  x: string,
  y: string,
  maxZoom: number
): TileCoords | null {
  const zi = Number(z)
  const xi = Number(x)
  const yi = Number(y)
  if (
    !Number.isInteger(zi) ||
    !Number.isInteger(xi) ||
    !Number.isInteger(yi) ||
    zi < 0 ||
    zi > maxZoom ||
    xi < 0 ||
    yi < 0 ||
    xi >= 2 ** zi ||
    yi >= 2 ** zi
  ) {
    return null
  }
  return { z: zi, x: xi, y: yi }
}

/** Fetch one tile and turn it into the HTTP response every tile route returns. */
export async function serveTile(archive: PMTiles, { z, x, y }: TileCoords): Promise<Response> {
  let tile: RangeResponse | undefined
  try {
    tile = await archive.getZxy(z, x, y)
  } catch {
    // A truncated/corrupt archive (e.g. mid-copy) — treat as unavailable.
    return Response.json({ error: 'Tile archive unreadable' }, { status: 503 })
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
