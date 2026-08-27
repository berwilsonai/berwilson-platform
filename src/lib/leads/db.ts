/**
 * Service-role client and row shapes for the leads module.
 *
 * Same arrangement as src/lib/email-sweep/db.ts and for the same reason:
 * `npm run gen-types` is disabled on this stack (the Supabase CLI runs
 * postgres-meta in a container and needs a DB host reachable from both host and
 * container, which Colima does not provide), so `leads` will never appear in the
 * generated Database type. Rather than scatter `as never` casts, this exports one
 * deliberately untyped client and carries the contract in the row types below.
 */

import { createClient } from '@supabase/supabase-js'
import type { LeadRoute } from '@/lib/ai/prompts/lead-triage'

export function leadsDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export type LeadStatus =
  | 'new'
  | 'reviewing'
  | 'promoted'
  | 'forwarded'
  | 'ignored'
  | 'expired'
  | 'spam'

export type LeadScoreState = 'pending' | 'scored' | 'failed' | 'skipped'

export type FitRecommendation = 'pursue' | 'consider' | 'pass'

/** A file pulled off the lead's email thread and staged in the documents bucket. */
export interface LeadAttachment {
  name: string
  mime_type: string | null
  size_bytes: number
  storage_path: string
  /** Whether the score phase managed to read this file's text. */
  extracted: boolean
}

export interface LeadRow {
  id: string
  thread_id: string
  mailbox: string | null

  route: LeadRoute
  status: LeadStatus
  spam_reason: string | null

  title: string
  received_at: string | null
  sender_name: string | null
  sender_email: string | null
  sender_company: string | null
  sender_phone: string | null

  summary: string | null
  scope: string | null
  location: string | null
  sector: string | null
  estimated_value: number | null

  solicitation_number: string | null
  bid_due_date: string | null
  site_visit_date: string | null
  rfi_due_date: string | null

  key_facts: string[]
  requirements: string[]
  triage_confidence: number | null

  fit_score: number | null
  fit_recommendation: FitRecommendation | null
  fit_summary: string | null
  fit_strengths: string[]
  fit_concerns: string[]
  fit_gaps: string[]
  fit_questions: string[]

  attachments: LeadAttachment[]
  score_state: LeadScoreState
  score_error: string | null

  promoted_project_id: string | null
  promoted_opportunity_id: string | null
  promoted_steel_deal_id: string | null
  promoted_at: string | null
  forwarded_to: string | null
  forwarded_at: string | null

  /**
   * Gmail's own id for the conversation, joined in from `email_threads`.
   *
   * NOT the same thing as `thread_id`, which is this platform's UUID primary
   * key on `email_threads` — passing that to Google returns "Invalid id value".
   * Present only on reads that ask for it; use {@link resolveGmailThreadId}
   * rather than reaching for `thread_id` when talking to Gmail.
   */
  gmail_thread_id?: string | null

  /**
   * What the platform has already written back into Gmail — the label last
   * applied to the thread, and the draft reply left for a human to send. Both
   * are latches: they are what stop a daily sweep relabelling and re-drafting
   * the same thread forever.
   */
  gmail_label: string | null
  gmail_labeled_at: string | null
  gmail_draft_id: string | null
  draft_created_at: string | null

  notes: string | null
  created_at: string | null
  updated_at: string | null
}

/** Statuses that still want a human decision — the working queue. */
export const OPEN_LEAD_STATUSES: LeadStatus[] = ['new', 'reviewing']

/** Tolerant parse of a jsonb string[] column. */
export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : []
}

/** Tolerant parse of the attachments jsonb column. */
export function parseLeadAttachments(value: unknown): LeadAttachment[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (a): a is LeadAttachment =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as LeadAttachment).name === 'string' &&
      typeof (a as LeadAttachment).storage_path === 'string'
  )
}

/**
 * PostgREST embed that carries Gmail's conversation id alongside a lead.
 *
 * `leads.thread_id` is a foreign key to `email_threads.id` — a UUID of this
 * platform's own making. Gmail knows the conversation by a different id
 * entirely, and handing it the UUID fails with "Invalid id value". Any read
 * that will go on to touch Gmail must include this.
 */
export const GMAIL_THREAD_EMBED = 'email_threads(gmail_thread_id)'

/** Shape PostgREST returns for the embed above. */
type WithThreadEmbed = { email_threads?: { gmail_thread_id?: string | null } | null }

/**
 * Pull Gmail's thread id off a row read with {@link GMAIL_THREAD_EMBED},
 * falling back to a flattened column when the caller has already flattened it.
 */
export function embeddedGmailThreadId(row: unknown): string | null {
  const r = row as (WithThreadEmbed & { gmail_thread_id?: string | null }) | null
  return r?.email_threads?.gmail_thread_id ?? r?.gmail_thread_id ?? null
}

/**
 * Look up Gmail's conversation id for a lead, for callers holding a plain
 * `LeadRow` that was read without the embed — the API routes, which select `*`.
 *
 * Deliberately a lookup rather than a required argument: a caller that forgets
 * gets the right answer at the cost of one small query, instead of silently
 * sending Google a UUID.
 */
export async function resolveGmailThreadId(
  lead: Pick<LeadRow, 'thread_id'> & { gmail_thread_id?: string | null }
): Promise<string | null> {
  const embedded = embeddedGmailThreadId(lead)
  if (embedded) return embedded
  if (!lead.thread_id) return null

  const { data } = await leadsDb()
    .from('email_threads')
    .select('gmail_thread_id')
    .eq('id', lead.thread_id)
    .maybeSingle()
  return (data as { gmail_thread_id?: string | null } | null)?.gmail_thread_id ?? null
}
