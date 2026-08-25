/**
 * Service-role client for the sweep tables.
 *
 * mailbox_sync, email_threads, and thread_clusters arrive in migration
 * 20260823000001, but src/types/database.ts is generated FROM the deployed
 * schema — so until `npm run gen-types` runs against the migrated database, the
 * Database type has no idea these tables exist and every call through
 * createAdminClient() would need an `as never` cast.
 *
 * Rather than scatter casts across the sweep, this returns one deliberately
 * untyped client and the row shapes below carry the contract instead. Once
 * types are regenerated this file can collapse into createAdminClient().
 */

import { createClient } from '@supabase/supabase-js'

export function sweepDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * Record that a sweep could not run at all, so the outage is VISIBLE.
 *
 * Without this, a cron that bails before the sweep starts (no Google
 * credential, most likely) leaves every mailbox_sync row reading its last
 * happy state. The dashboard's mailbox alert keys on state='failed', so mail
 * silently stops reaching the CRM while every screen looks healthy — which is
 * exactly what happened on 2026-08-25 after the Studio crash took the OAuth
 * tokens with it.
 *
 * Safe with respect to resume: fetchMailbox decides where to restart from
 * `completed_at`, never from `state`, so a mailbox marked failed here still
 * catches up over a short window rather than re-reading years of history. The
 * next successful run overwrites the state, so this self-heals.
 *
 * Never throws — failing to record a failure must not turn a 503 into a 500.
 */
export async function recordSweepUnavailable(
  mailboxes: readonly string[],
  reason: string
): Promise<void> {
  try {
    const db = sweepDb()
    const now = new Date().toISOString()
    for (const mailbox of mailboxes) {
      const { error } = await db.from('mailbox_sync').upsert(
        { mailbox, state: 'failed', last_error: reason, updated_at: now },
        { onConflict: 'mailbox' }
      )
      if (error) console.error(`[sweep] could not flag ${mailbox} as failed:`, error.message)
    }
  } catch (err) {
    console.error('[sweep] could not record unavailability:', err)
  }
}

// ---------------------------------------------------------------------------
// Row shapes — the hand-maintained stand-in for the generated types
// ---------------------------------------------------------------------------

export type SweepState = 'idle' | 'running' | 'complete' | 'failed'
export type SummaryState = 'pending' | 'summarized' | 'failed' | 'skipped'
export type ClusterState = 'open' | 'staged' | 'dismissed'

export interface MailboxSyncRow {
  mailbox: string
  page_token: string | null
  state: SweepState
  since_days: number | null
  threads_seen: number
  threads_new: number
  duplicates_skipped: number
  last_error: string | null
  started_at: string | null
  completed_at: string | null
  updated_at: string | null
}

export interface EmailThreadRow {
  id: string
  fingerprint: string
  mailbox: string
  gmail_thread_id: string
  subject: string | null
  participants: string[]
  first_at: string | null
  last_at: string | null
  message_count: number
  attachment_count: number
  raw_markdown: string | null
  summary: unknown | null
  summary_state: SummaryState
  summary_error: string | null
  cluster_id: string | null
  created_at: string | null
  updated_at: string | null
}

export interface ThreadClusterRow {
  id: string
  label: string | null
  state: ClusterState
  reason: string | null
  thread_count: number
  participants: string[]
  first_at: string | null
  last_at: string | null
  session_id: string | null
  created_at: string | null
  updated_at: string | null
}
