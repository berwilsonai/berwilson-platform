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

// Service role client — API routes ONLY. Never expose to the browser.
// For user-initiated mutations prefer actorAdminClient() (lib/auth/viewer.ts),
// which passes the signed-in user through for activity-log attribution.
export function createAdminClient(actor?: AdminActor) {
  const headers: Record<string, string> = {}
  if (actor) {
    headers['x-actor-id'] = actor.id
    if (actor.email) headers['x-actor-email'] = actor.email
  }
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      ...(actor ? { global: { headers } } : {}),
    }
  )
}
