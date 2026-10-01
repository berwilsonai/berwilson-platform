/**
 * Security events, written to the append-only activity log.
 *
 * Everything here is deliberately recorded even when it FAILED. A successful
 * unlock is routine; three refused codes against a confidential project at
 * 02:00 is the single most useful thing this whole feature can tell anyone, and
 * it only exists if the failures are written down too.
 *
 * activity_log has no UPDATE or DELETE policy, ever (CLAUDE.md §4) — which is
 * exactly the property a security log needs.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'
import type { Viewer } from '@/lib/auth/viewer'

export type SecurityAction =
  | 'step_up_granted'
  | 'step_up_refused'
  | 'step_up_no_authenticator'
  | 'confidential_enabled'
  | 'confidential_disabled'
  | 'mfa_enrolled'
  | 'mfa_removed'
  | 'step_ups_cleared'

export interface SecurityEventInput {
  action: SecurityAction
  viewer: Viewer | null
  projectId?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Never throws. A security feature that 500s because its own logging failed is
 * worse than one that logs to stderr — but the stderr line is not optional,
 * because a silent gap in an audit trail is indistinguishable from quiet.
 */
export async function logSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from('activity_log')
      .insert({
        table_name: 'projects',
        record_id: input.projectId ?? null,
        project_id: input.projectId ?? null,
        action: input.action,
        actor_id: input.viewer?.authUserId ?? null,
        actor_email: input.viewer?.email ?? null,
        actor_type: 'user',
        metadata: ((input.metadata ?? {}) as unknown) as Json,
      })
    if (error) console.error('[security-audit] insert failed:', input.action, error.message)
  } catch (err) {
    console.error('[security-audit] insert threw:', input.action, err)
  }
}
