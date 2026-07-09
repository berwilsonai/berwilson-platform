import { geocodeLocation } from '@/lib/map/geocode'

// Offline location lookup for /map placement — resolves free-text locations
// against the bundled Census gazetteer (src/lib/map/geocode.ts). Nothing
// leaves the box. Auth is the middleware (admin-only: /api/map is not in
// ROLE_API_PREFIXES).

interface GeocodeQuery {
  id: string
  text: string
}

export async function POST(request: Request) {
  let body: { queries?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.queries) || body.queries.length === 0) {
    return Response.json({ error: 'queries must be a non-empty array' }, { status: 400 })
  }
  if (body.queries.length > 500) {
    return Response.json({ error: 'Too many queries (max 500)' }, { status: 400 })
  }

  const results = (body.queries as GeocodeQuery[]).map((q) => {
    if (typeof q?.id !== 'string' || typeof q?.text !== 'string') return null
    const match = geocodeLocation(q.text)
    return { id: q.id, ...(match ?? { latitude: null }) }
  })

  return Response.json({ results: results.filter(Boolean) })
}
