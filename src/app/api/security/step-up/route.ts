import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { checkRateLimit } from '@/lib/rate-limit'
import { clearStepUps, hasStepUp, isConfidentialProject, recordStepUp, STEP_UP_TTL_MS } from '@/lib/security/confidential'
import { primaryVerifiedFactorId, verifyCode } from '@/lib/security/mfa'
import { logSecurityEvent } from '@/lib/security/audit'
import { mayStepUp } from '@/lib/security/request'

/**
 * POST   /api/security/step-up  { projectId, code } — open a confidential project
 * DELETE /api/security/step-up  ?projectId=…        — lock it again now
 *
 * The code is checked against the caller's own enrolled authenticator by the
 * LOCAL gotrue container. Nothing leaves the Studio, and there is no shared
 * secret anywhere in the system to write down or pass on.
 */

// Five attempts per user per five minutes. gotrue rate-limits MFA verification
// of its own accord; this is in front of it so a loop against this route cannot
// spend that budget and lock the real user out of their own project.
const MAX_ATTEMPTS = 5
const WINDOW_MS = 5 * 60 * 1000

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!mayStepUp(viewer)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : ''

  if (!projectId) return NextResponse.json({ error: 'No project named.' }, { status: 400 })

  // Not confidential → nothing to unlock. Answering 400 rather than quietly
  // writing a session keeps step_up_sessions meaningful as an audit record:
  // every row in it is a real unlock of a real protected project.
  if (!(await isConfidentialProject(projectId))) {
    return NextResponse.json({ error: 'That project is not protected.' }, { status: 400 })
  }

  const factorId = await primaryVerifiedFactorId()
  if (!factorId) {
    await logSecurityEvent({ action: 'step_up_no_authenticator', viewer, projectId })
    return NextResponse.json(
      {
        error: 'No authenticator is set up on your account yet.',
        needsEnrollment: true,
      },
      { status: 409 }
    )
  }

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the six digits from your authenticator.' }, { status: 400 })
  }

  const limit = checkRateLimit(`step-up:${viewer!.authUserId}`, MAX_ATTEMPTS, WINDOW_MS)
  if (!limit.allowed) {
    await logSecurityEvent({
      action: 'step_up_refused',
      viewer,
      projectId,
      metadata: { reason: 'rate_limited' },
    })
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.`,
      },
      { status: 429 }
    )
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = request.headers.get('user-agent')

  const failure = await verifyCode(factorId, code)
  if (failure) {
    // Logged on purpose. A refused code is the only signal this feature can
    // give that someone is trying, and it only exists if the failures are
    // written down beside the successes.
    await logSecurityEvent({
      action: 'step_up_refused',
      viewer,
      projectId,
      metadata: { reason: 'bad_code', ip, factor_id: factorId },
    })
    return NextResponse.json({ error: failure }, { status: 401 })
  }

  const sessionId = await recordStepUp({
    authUserId: viewer!.authUserId,
    projectId,
    factorId,
    ip,
    userAgent,
  })
  if (!sessionId) {
    return NextResponse.json(
      { error: 'The code was right but the unlock could not be recorded. Try again.' },
      { status: 500 }
    )
  }

  await logSecurityEvent({
    action: 'step_up_granted',
    viewer,
    projectId,
    metadata: { session_id: sessionId, ip, factor_id: factorId, ttl_ms: STEP_UP_TTL_MS },
  })

  return NextResponse.json({ ok: true, expiresInMs: STEP_UP_TTL_MS })
}

/**
 * Lock again, now — without waiting out the half hour.
 *
 * No projectId closes every session this user holds, which is what the "Lock
 * everything" control in Settings → Security is for.
 */
export async function DELETE(request: NextRequest) {
  const viewer = await getViewer()
  if (!mayStepUp(viewer)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const projectId = request.nextUrl.searchParams.get('projectId') ?? undefined
  const closed = await clearStepUps({ authUserId: viewer!.authUserId, projectId })
  await logSecurityEvent({
    action: 'step_ups_cleared',
    viewer,
    projectId: projectId ?? null,
    metadata: { sessions_closed: closed },
  })
  return NextResponse.json({ ok: true, sessionsClosed: closed })
}

/** GET — is this project open for me right now, and for how much longer? */
export async function GET(request: NextRequest) {
  const viewer = await getViewer()
  if (!mayStepUp(viewer)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const projectId = request.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'No project named.' }, { status: 400 })
  return NextResponse.json({ unlocked: await hasStepUp(viewer!.authUserId, projectId) })
}
