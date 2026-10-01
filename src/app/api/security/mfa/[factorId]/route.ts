import { NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { listTotpFactors, unenroll } from '@/lib/security/mfa'
import { clearStepUps } from '@/lib/security/confidential'
import { logSecurityEvent } from '@/lib/security/audit'
import { mayStepUp } from '@/lib/security/request'

/**
 * DELETE /api/security/mfa/[factorId] — remove one authenticator.
 *
 * Removing the LAST verified factor also closes every step-up session this user
 * holds. Otherwise handing in your authenticator would leave the projects it
 * opened sitting open for up to half an hour — the one moment when that is
 * least acceptable.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ factorId: string }> }
) {
  const viewer = await getViewer()
  if (!mayStepUp(viewer)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { factorId } = await params
  const before = await listTotpFactors()
  if (!before.some((f) => f.id === factorId)) {
    return NextResponse.json({ error: 'No such authenticator on this account.' }, { status: 404 })
  }

  const failure = await unenroll(factorId)
  if (failure) return NextResponse.json({ error: failure }, { status: 400 })

  const verifiedLeft = (await listTotpFactors()).filter((f) => f.status === 'verified').length
  let closed = 0
  if (verifiedLeft === 0) closed = await clearStepUps({ authUserId: viewer!.authUserId })

  await logSecurityEvent({
    action: 'mfa_removed',
    viewer,
    metadata: { factor_id: factorId, verified_remaining: verifiedLeft, sessions_closed: closed },
  })
  return NextResponse.json({ ok: true, verifiedRemaining: verifiedLeft, sessionsClosed: closed })
}
