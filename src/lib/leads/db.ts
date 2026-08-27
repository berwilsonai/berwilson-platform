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
