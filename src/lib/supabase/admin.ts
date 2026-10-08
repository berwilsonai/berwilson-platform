import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

/**
 * Acting user stamped onto service-role requests as x-actor-id / x-actor-email
 * headers. The log_activity trigger reads them (via request.headers) so the
 * activity log can attribute writes that would otherwise show as "system".
 */
export interface AdminActor {
  id: string
  email?: string | null
}

/**
 * The one place the service-role connection and the actor-attribution contract
 * are expressed. Both factories below share it, so a change to either — the URL
 * a tailnet move rewrites, the header names the trigger reads — lands once.
 */
function adminOptions(actor?: AdminActor) {
  const auth = { autoRefreshToken: false, persistSession: false }
  if (!actor) return { auth }
  const headers: Record<string, string> = { 'x-actor-id': actor.id }
  if (actor.email) headers['x-actor-email'] = actor.email
  return { auth, global: { headers } }
}

// Service role client — API routes ONLY. Never expose to the browser.
// For user-initiated mutations prefer actorAdminClient() (lib/auth/viewer.ts),
// which passes the signed-in user through for activity-log attribution.
export function createAdminClient(actor?: AdminActor) {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    adminOptions(actor)
  )
}

/**
 * The same client WITHOUT the generated Database type, for the tables that
 * post-date the last type generation (§4 — `npm run gen-types` is a disabled
 * stub against the self-hosted DB).
 *
 * ⚠ THE ONLY DIFFERENCE FROM createAdminClient IS THE MISSING GENERIC, and that
 * is the whole reason this exists: five modules had each copied the connection
 * and the actor-header block to get it, which is nine function bodies for one
 * behaviour. Each module keeps its own named alias (`sweepDb`, `calcDb`, …) so
 * the convention and the call sites are unchanged, but every one of them now
 * delegates here. A module gets its row contracts from its own hand-maintained
 * interfaces, never from this client.
 */
export function createUntypedAdminClient(actor?: AdminActor) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    adminOptions(actor)
  )
}
