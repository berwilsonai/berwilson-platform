import { NextRequest } from 'next/server'

import { getViewer, canAccessOpportunity, forbiddenJson } from '@/lib/auth/viewer'
import { requireProjectAccess } from '@/lib/security/guard'
import { ComposeError, composeDocument, type ComposeTarget } from '@/lib/documents/compose'
import { COMPOSE_KIND_KEYS, composeKind } from '@/lib/documents/compose-kinds'

/**
 * Ber AI writes a document on a deal, files it, and texts the link.
 *
 * ⚠ THE HANDLER AWAITS THE WHOLE PASS, DELIBERATELY. Composing is a model call
 * of minutes (median Ber AI answer 73s, p90 455s), and work fired off after a
 * handler returns dies with the next kickstart — a deploy IS a kickstart (§12).
 * So there is no background queue to lose: the request is recorded in
 * `composed_documents` before any work starts, the pass runs inside the
 * handler, and if the browser gives up waiting the document still lands and the
 * text still arrives. A later page load reads the job row to catch up.
 *
 * ⚠ THE TWO KINDS TAKE DIFFERENT ACCESS CHECKS, as in `/api/updates/save`. The
 * record id arrives in the BODY, where the middleware's step-up gate cannot see
 * it (§12), so this route carries its own: a project through
 * `requireProjectAccess` (which can answer "locked — step up first"), an
 * opportunity through its access grant. Containment — a protected project's
 * document never reaching Drive or a phone — is enforced inside
 * `composeDocument`, not here, because that is the choke point every future
 * caller passes through.
 */
export const maxDuration = 600

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'A JSON body is required' }, { status: 400 })
  }

  const { project_id, opportunity_id, document_kind, instructions } = body as {
    project_id?: string
    opportunity_id?: string
    document_kind?: string
    instructions?: string
  }

  // Exactly one, never both — the same exactly-one rule the shared-children
  // tables carry as a CHECK (§4).
  if (!!project_id === !!opportunity_id) {
    return Response.json(
      { error: 'exactly one of project_id or opportunity_id is required' },
      { status: 400 }
    )
  }

  // Named rather than a bare 400: a stale picker is then diagnosable, and the
  // list comes from the registry so this message cannot drift from it (§12).
  if (!composeKind(document_kind)) {
    return Response.json(
      {
        error: `Unknown document kind${document_kind ? ` "${document_kind}"` : ''}.`,
        kinds: COMPOSE_KIND_KEYS,
      },
      { status: 400 }
    )
  }

  if (!instructions || typeof instructions !== 'string' || instructions.trim().length < 10) {
    return Response.json(
      { error: 'Say what the document should cover — a sentence is enough.' },
      { status: 400 }
    )
  }

  const target: ComposeTarget = project_id
    ? { kind: 'project', id: project_id }
    : { kind: 'opportunity', id: opportunity_id as string }

  const viewer = await getViewer()
  if (!viewer) return forbiddenJson()

  if (target.kind === 'project') {
    const denied = await requireProjectAccess(target.id)
    if (denied) return denied
  } else if (!viewer.isAdmin && !canAccessOpportunity(viewer, target.id)) {
    return forbiddenJson()
  }

  try {
    const result = await composeDocument({
      target,
      documentKind: document_kind as string,
      instructions,
      // Stamped from the signed-in viewer, never the client: this decides whose
      // phone the link goes to.
      requestedBy: { id: viewer.authUserId, email: viewer.email ?? null },
    })
    return Response.json(result, { status: result.status === 'ready' ? 200 : 422 })
  } catch (err) {
    if (err instanceof ComposeError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Could not write the document'
    console.error('Compose document failed:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
