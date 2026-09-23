/**
 * PATCH /api/commitments/[id] — settle a commitment.
 *
 * Admin-only by DEFAULT-DENY: `/api/commitments` appears in no allowlist in
 * permissions.ts, so the middleware refuses every other role before this runs.
 * The in-route guard is here anyway, per the standing posture that the layer
 * whose job is not to trust the one above it should not — and because
 * matchesPrefix is a prefix match and is NOT method-aware, so allowlisting a
 * read under this path would silently admit this write too.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
// The untyped service client, as every sweep-era table uses: `commitments`
// post-dates the last type generation and gen-types cannot run against this
// self-hosted stack. Attribution does not go through actorAdminClient here
// because this table carries no log_activity() trigger — the settler is
// recorded on the row itself, from the session, never from the body.
import { sweepDb } from '@/lib/email-sweep/db'
import { HUMAN_SETTLED, type CommitmentStatus } from '@/lib/commitments/db'

/** Only the human verdicts are settable here. */
const SETTLEABLE: CommitmentStatus[] = [...HUMAN_SETTLED, 'open']

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer || !viewer.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { status?: string }
  const status = body.status as CommitmentStatus | undefined

  if (!status || !SETTLEABLE.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${SETTLEABLE.join(', ')}` },
      { status: 400 }
    )
  }

  const supabase = sweepDb()

  // Reopening clears the settlement, or a row would carry a closer who has not
  // looked at it since — the same rule the dev-notes build settled on.
  const patch =
    status === 'open'
      ? { status, settled_at: null, settled_by: null }
      : {
          status,
          settled_at: new Date().toISOString(),
          settled_by: viewer.teamMemberName ?? viewer.email ?? 'unknown',
        }

  const { data, error } = await supabase
    .from('commitments')
    .update(patch)
    .eq('id', id)
    .select('id, status')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Selected back so a miss is a 404, not a 200 that silently did nothing.
  if (!data) return NextResponse.json({ error: 'Commitment not found' }, { status: 404 })

  return NextResponse.json({ ok: true, id: data.id, status: data.status })
}
