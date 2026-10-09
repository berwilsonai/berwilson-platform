/**
 * PATCH /api/commitments/[id] — settle a commitment.
 *
 * Admin-only by DEFAULT-DENY: `/api/commitments` appears in no allowlist in
 * permissions.ts, so the middleware refuses every other role before this runs.
 * The in-route guard is here anyway, per the standing posture that the layer
 * whose job is not to trust the one above it should not — and because
 * matchesPrefix is a prefix match and is NOT method-aware, so allowlisting a
 * read under this path would silently admit this write too.
 *
 * ⚠ THE SETTLE ITSELF LIVES IN src/lib/commitments/settle.ts, not here. Three
 * callers record a verdict — this route, the token-authed POST behind a
 * morning-note link, and the page — and §12's rule is to add a parameter
 * rather than fork a shared pass. The parameter is WHO decided, which is the
 * only thing the three genuinely disagree about.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { settleCommitment, VERDICTS, type Verdict } from '@/lib/commitments/settle'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer || !viewer.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { status?: string }
  const verdict = body.status as Verdict | undefined

  if (!verdict || !VERDICTS.includes(verdict)) {
    return NextResponse.json(
      { error: `status must be one of: ${VERDICTS.join(', ')}` },
      { status: 400 }
    )
  }

  // Attribution comes from the session, never from the body. This table carries
  // no log_activity() trigger, so the settler on the row IS the audit trail.
  const result = await settleCommitment(
    id,
    verdict,
    viewer.teamMemberName ?? viewer.email ?? 'unknown'
  )

  if (!result.ok) {
    const status = result.error === 'Commitment not found' ? 404 : 500
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({
    ok: true,
    id,
    status: result.status,
    snoozedUntil: result.snoozedUntil ?? null,
  })
}
