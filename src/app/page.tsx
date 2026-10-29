import { redirect } from 'next/navigation'

import { DEFAULT_LANDING } from '@/lib/auth/permissions'

/**
 * The front door.
 *
 * ⚠ IT READS THE LANDING FROM THE PERMISSIONS REGISTRY RATHER THAN NAMING ONE.
 * This file held a hardcoded `redirect('/tasks')` from 2026-06-25 while
 * `landingFor()` and `middleware.ts` each held their own copy of the same
 * decision — three homes for one string, which is the §12 shape where the
 * reader that lies to you is found last.
 *
 * A non-admin never arrives here: `/` is not in any `ROLE_PAGE_PREFIXES` list,
 * so the middleware's role gate bounces them to `landingFor(role)` — inside
 * their own allowlist — before this renders. So the admin landing is the only
 * one this file needs to know.
 */
export default function Home() {
  redirect(DEFAULT_LANDING)
}
