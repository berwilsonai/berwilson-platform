/**
 * TOTP (authenticator-app) multi-factor auth, served by the LOCAL Supabase Auth
 * container — nothing here reaches the internet.
 *
 * Why TOTP and not a texted code: gotrue's factor types are `totp`, `webauthn`
 * and `phone`. `phone` means SMS, which needs a third-party provider
 * (`sms_provider` is empty on this stack) and would send a code and a phone
 * number off the box — against the whole point of the 2026-07-07 local cutover.
 * TOTP is HMAC over a shared secret and the clock: it works with no network at
 * all, which is also what makes it correct for a tailnet-only platform.
 *
 * Why not a per-project password, which is what was originally asked for: a
 * shared secret gets written down, never rotates, and is the same for whoever
 * asks. A TOTP code is per-person, lives for 30 seconds, and cannot be told to
 * anyone usefully.
 *
 * All of this runs through the USER-SCOPED client (anon key + the caller's own
 * cookies). The service-role client cannot enrol or verify a factor — it has no
 * user — and that is the right shape: a step-up must be something the signed-in
 * person did, not something the server did on their behalf.
 */

import { createClient } from '@/lib/supabase/server'

export interface TotpFactor {
  id: string
  friendlyName: string | null
  status: 'verified' | 'unverified'
  createdAt: string | null
}

/** Every TOTP factor on the caller's own account, verified or not. */
export async function listTotpFactors(): Promise<TotpFactor[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) {
    console.error('[mfa] listFactors failed:', error.message)
    return []
  }
  // `data.totp` holds only VERIFIED factors; `data.all` includes pending
  // enrolments, which the settings screen has to show or a half-finished
  // enrolment is invisible and un-deletable.
  return (data?.all ?? [])
    .filter((f) => f.factor_type === 'totp')
    .map((f) => ({
      id: f.id,
      friendlyName: f.friendly_name ?? null,
      status: f.status === 'verified' ? 'verified' : 'unverified',
      createdAt: f.created_at ?? null,
    }))
}

export async function hasVerifiedTotp(): Promise<boolean> {
  return (await listTotpFactors()).some((f) => f.status === 'verified')
}

export interface EnrollResult {
  factorId: string
  /** SVG markup for the QR code, straight from gotrue. */
  qrCode: string
  /** otpauth:// URI, for pasting into a password manager by hand. */
  uri: string
  secret: string
}

/**
 * Start enrolling an authenticator. The factor exists immediately but stays
 * `unverified` until confirmEnrollment() sees a correct code — so nothing is
 * protected by a factor the user has not actually scanned.
 */
export async function beginEnrollment(friendlyName: string): Promise<EnrollResult | string> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  })
  if (error || !data) return error?.message ?? 'Could not start enrolment'
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    uri: data.totp.uri,
    secret: data.totp.secret,
  }
}

/**
 * Finish enrolment, or step up an existing factor — gotrue uses the same
 * challenge/verify pair for both, and on success the session is upgraded to
 * aal2 and new cookies are written.
 *
 * Returns null on success, or a human-readable reason. The reason is
 * deliberately vague about WHY a code failed (wrong code vs expired challenge
 * vs clock drift all read the same to an attacker), with one exception: a rate
 * limit says so, because a person who has fat-fingered three codes needs to
 * know to wait rather than keep trying.
 */
export async function verifyCode(factorId: string, code: string): Promise<string | null> {
  const supabase = await createClient()

  const challenge = await supabase.auth.mfa.challenge({ factorId })
  if (challenge.error || !challenge.data) {
    return challenge.error?.message ?? 'Could not start the challenge'
  }

  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  })
  if (error) {
    if (error.status === 429) return 'Too many attempts — wait a minute and try again.'
    return 'That code was not accepted. Check your authenticator and try the next one.'
  }
  return null
}

/**
 * Remove a factor.
 *
 * ⚠ This does NOT close any open step-up session — a cleared challenge is a
 * fact about a moment that has already happened. Callers that mean "lock
 * everything now" must also clearStepUps() (src/lib/security/confidential.ts).
 */
export async function unenroll(factorId: string): Promise<string | null> {
  const supabase = await createClient()
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  return error ? error.message : null
}

/**
 * The verified factor to challenge for a step-up.
 *
 * Returns null when the user has none — which the caller must report as "set up
 * an authenticator first" and never as a failed code. Those are different
 * problems and only one of them is fixable at the prompt.
 */
export async function primaryVerifiedFactorId(): Promise<string | null> {
  const verified = (await listTotpFactors()).filter((f) => f.status === 'verified')
  return verified[0]?.id ?? null
}
