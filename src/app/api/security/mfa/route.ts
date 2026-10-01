import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { beginEnrollment, listTotpFactors, verifyCode } from '@/lib/security/mfa'
import { logSecurityEvent } from '@/lib/security/audit'
import { mayStepUp } from '@/lib/security/request'

/**
 * GET  /api/security/mfa            — the caller's own authenticators
 * POST /api/security/mfa            — { name }          start enrolment
 * POST /api/security/mfa?confirm=1  — { factorId, code } finish enrolment
 *
 * Admin-only, matching mayStepUp(): only an admin can hold a step-up, so only
 * an admin has anything to enrol an authenticator FOR. (/api/security is absent
 * from every ROLE_API_PREFIXES list, so the middleware already turns non-admins
 * away — this is the second check, not the only one.)
 *
 * A factor is created `unverified` and stays that way until a correct code
 * arrives, so an abandoned enrolment never protects anything.
 */

export async function GET() {
  const viewer = await getViewer()
  if (!mayStepUp(viewer)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ factors: await listTotpFactors() })
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!mayStepUp(viewer)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const confirming = request.nextUrl.searchParams.get('confirm') === '1'

  if (!confirming) {
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, 60)
        : 'Authenticator'
    const result = await beginEnrollment(name)
    if (typeof result === 'string') return NextResponse.json({ error: result }, { status: 400 })
    // The secret and the QR are returned ONCE, to the enrolling admin's own
    // browser, over the tailnet. They are not stored here and not logged.
    return NextResponse.json(result)
  }

  const factorId = typeof body.factorId === 'string' ? body.factorId : ''
  const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : ''
  if (!factorId || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the six digits from your authenticator.' }, { status: 400 })
  }

  const failure = await verifyCode(factorId, code)
  if (failure) return NextResponse.json({ error: failure }, { status: 400 })

  await logSecurityEvent({ action: 'mfa_enrolled', viewer, metadata: { factor_id: factorId } })
  return NextResponse.json({ ok: true })
}
