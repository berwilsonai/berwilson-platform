import type { NextRequest } from 'next/server'
import { createReadStream, promises as fs } from 'fs'
import { Readable } from 'stream'
import os from 'os'
import path from 'path'

// Serves the self-hosted Protomaps .pmtiles archive with HTTP range support.
// The file is multi-GB and lives OUTSIDE the app dir (survives the deploy
// rsync --delete); see scripts/setup-map-data.sh and deploy/README.md.
// Auth is the middleware (admin-only: /api/map is not in ROLE_API_PREFIXES).

const PMTILES_PATH =
  process.env.MAP_PMTILES_PATH || path.join(os.homedir(), 'berwilson-data/maps/us.pmtiles')

export async function GET(request: NextRequest) {
  let size: number
  try {
    const stat = await fs.stat(PMTILES_PATH)
    size = stat.size
  } catch {
    return Response.json(
      { error: 'Basemap not installed — run scripts/setup-map-data.sh (see deploy/README.md)' },
      { status: 503 }
    )
  }

  const baseHeaders: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'private, max-age=86400',
  }

  const range = request.headers.get('range')
  const match = range ? /^bytes=(\d+)-(\d+)?$/.exec(range) : null

  if (!match) {
    // The pmtiles client always sends Range; be correct for anything else.
    const stream = Readable.toWeb(createReadStream(PMTILES_PATH)) as ReadableStream
    return new Response(stream, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(size) },
    })
  }

  const start = Number(match[1])
  const end = match[2] !== undefined ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    })
  }

  const stream = Readable.toWeb(createReadStream(PMTILES_PATH, { start, end })) as ReadableStream
  return new Response(stream, {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    },
  })
}
