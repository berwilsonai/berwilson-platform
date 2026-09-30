import { NextRequest } from 'next/server'
import { getViewer, actorAdminClient, forbiddenJson } from '@/lib/auth/viewer'
import {
  refileDocument,
  excludeDocument,
  confirmDocumentFiling,
  type RefileTarget,
} from '@/lib/documents/refile'

/**
 * File a document onto the record it belongs to, or mark it as not knowledge.
 *
 * Admin-only. Re-filing changes what Ber AI retrieves for everyone — a document
 * leaving the company corpus stops widening every project-scoped question — so
 * this is not a per-project grant the way opening a document is.
 *
 * `actorAdminClient()` rather than `createAdminClient()`, or the activity log
 * records a filing decision as "system" and there is no way back to who made it
 * (§12). The whole value of a filing decision is that it is attributable.
 */
export const maxDuration = 60

interface RouteContext {
  params: Promise<{ id: string }>
}

const TARGET_TABLES = {
  project: 'projects',
  opportunity: 'opportunities',
  steel_deal: 'steel_deals',
} as const

export async function POST(request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson()

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const supabase = await actorAdminClient()

  // "Not knowledge" — a filing decision, not a deletion. The row stays as its
  // own tombstone so the nightly Drive sync cannot bring the file back.
  if (body.exclude === true) {
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : 'Not company knowledge.'
    try {
      const { chunks } = await excludeDocument(supabase, id, reason)
      return Response.json({ excluded: true, chunks })
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Could not exclude the document.' },
        { status: 500 }
      )
    }
  }

  const target = body.target as { kind?: unknown; id?: unknown } | undefined
  const kind = target?.kind
  const targetId = target?.id
  if (
    (kind !== 'project' && kind !== 'opportunity' && kind !== 'steel_deal') ||
    typeof targetId !== 'string' ||
    !targetId
  ) {
    return Response.json(
      { error: 'Provide target: { kind: "project" | "opportunity" | "steel_deal", id } — or exclude: true.' },
      { status: 400 }
    )
  }

  // The destination is checked to EXIST before anything moves. A dangling id
  // would otherwise take the document out of the company corpus and put it
  // nowhere — the one outcome worse than leaving it misfiled, because the
  // passage is then unreachable from any record.
  const { data: dest, error: destErr } = await supabase
    .from(TARGET_TABLES[kind])
    .select('id, name')
    .eq('id', targetId)
    .maybeSingle()
  if (destErr) return Response.json({ error: destErr.message }, { status: 500 })
  if (!dest) return Response.json({ error: `That ${kind.replace('_', ' ')} no longer exists.` }, { status: 404 })

  try {
    const result = await refileDocument(supabase, id, { kind, id: targetId } as RefileTarget)
    return Response.json({
      filed: true,
      target: { kind, id: targetId, name: (dest as { name: string }).name },
      chunks: result.chunks,
      crossedTables: result.crossedTables,
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not re-file the document.' },
      { status: 500 }
    )
  }
}

/**
 * "This document is right where it is."
 *
 * PATCH rather than POST because that is the verb /decide's dismiss already
 * sends, and this IS a dismissal — the row leaves the queue without anything
 * about the document changing. `confirm: false` puts it back.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson()

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  if (typeof body.confirm !== 'boolean') {
    return Response.json({ error: 'confirm must be true or false.' }, { status: 400 })
  }

  const supabase = await actorAdminClient()
  try {
    await confirmDocumentFiling(supabase, id, body.confirm)
    return Response.json({ confirmed: body.confirm })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not record the decision.' },
      { status: 500 }
    )
  }
}
