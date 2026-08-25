/**
 * Lead phase 3 — SCORE.
 *
 * Runs only on threads that survived triage, which is the point: pulling
 * attachments costs a Gmail round trip per file (Gmail, unlike Graph, does not
 * inline bytes) and the fit assessment costs a model call with the whole company
 * profile in context. Neither is worth spending on a newsletter.
 *
 * Three steps per lead:
 *   1. Download the thread's real attachments and stage them in the documents
 *      bucket, so the RFP survives even if the mail is later deleted.
 *   2. Extract their text LOCALLY — unpdf for PDFs, mammoth for .docx. In local
 *      mode neither costs a model call, so reading a 200-page RFP is nearly free.
 *   3. Run assessFit() unchanged. It already grounds itself in the company
 *      profile plus retrieved evidence from the company knowledge base, and
 *      returns the score/summary/strengths/concerns/gaps/questions shape the UI
 *      already knows how to render.
 */

import { assessFit } from '@/lib/ai/fit-assessment'
import type { ProposalExtraction } from '@/lib/ai/proposal-matching'
import { transcribePdfText, extractDocxText } from '@/lib/ai/document-text'
import { documentKind } from '@/lib/ai/document-pipeline'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchThread, fetchAttachmentBytes } from '@/lib/integrations/google-workspace'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import { sweepDb, type EmailThreadRow } from '@/lib/email-sweep/db'
import { leadsDb, type LeadAttachment, type LeadRow } from './db'

/** Where staged lead files live in the documents bucket. */
export const LEAD_FOLDER = 'leads'

/** Skip anything bigger — a 40MB drawing set is not worth the round trip. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** Attachments pulled per lead. Bid packages routinely carry dozens. */
const MAX_ATTACHMENTS = 8

/** Extracted attachment text handed to the assessor, across all files. */
const MAX_ATTACHMENT_TEXT = 60_000

const BATCH = 10

export interface ScoreProgress {
  processed: number
  scored: number
  failed: number
  remaining: number
  attachmentsStaged: number
  outOfTime: boolean
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

/**
 * Download, stage, and read one lead's attachments.
 *
 * Never throws: a lead with unreadable files is still worth scoring from the
 * email body alone, so failures degrade to a shorter evidence block.
 */
async function stageAttachments(
  lead: Pick<LeadRow, 'id'>,
  thread: Pick<EmailThreadRow, 'mailbox' | 'gmail_thread_id'>
): Promise<{ attachments: LeadAttachment[]; text: string }> {
  const staged: LeadAttachment[] = []
  const chunks: string[] = []

  try {
    const messages = await fetchThread(thread.mailbox, thread.gmail_thread_id)
    const supabase = createAdminClient()

    const refs = messages
      .flatMap((m) => m.attachments)
      .filter((a) => !a.isInline && a.size > 0 && a.size <= MAX_ATTACHMENT_BYTES)

    // Bid packages resend the same drawing on every reply — dedupe on
    // name+size before paying for the download.
    const seen = new Set<string>()
    const unique = refs.filter((a) => {
      const key = `${a.name}:${a.size}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    for (const ref of unique.slice(0, MAX_ATTACHMENTS)) {
      try {
        const base64 = await fetchAttachmentBytes(thread.mailbox, ref.messageId, ref.attachmentId)
        if (!base64) continue
        const buffer = Buffer.from(base64, 'base64')

        const path = `${LEAD_FOLDER}/${lead.id}/${Date.now()}-${sanitizeFileName(ref.name)}`
        const { error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(path, buffer, { contentType: ref.mimeType || 'application/octet-stream' })
        if (uploadErr) {
          console.error(`[leads/score] could not stage ${ref.name}:`, uploadErr.message)
          continue
        }

        // Local extraction — no model call in local mode for either branch.
        let text: string | null = null
        const kind = documentKind(ref.mimeType, ref.name)
        if (kind === 'pdf') {
          text = await transcribePdfText({
            dataBase64: base64,
            byteLength: buffer.byteLength,
            fileName: ref.name,
            userId: SYSTEM_USER_ID,
          })
        } else if (kind === 'docx') {
          text = await extractDocxText(
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
          )
        } else if (kind === 'text') {
          text = buffer.toString('utf8')
        }

        if (text?.trim()) chunks.push(`### Attachment: ${ref.name}\n\n${text.trim()}`)

        staged.push({
          name: ref.name,
          mime_type: ref.mimeType || null,
          size_bytes: ref.size,
          storage_path: path,
          extracted: !!text?.trim(),
        })
      } catch (err) {
        console.error(
          `[leads/score] attachment ${ref.name} failed:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }
  } catch (err) {
    console.error(
      '[leads/score] could not read thread attachments:',
      err instanceof Error ? err.message : String(err)
    )
  }

  return { attachments: staged, text: chunks.join('\n\n').slice(0, MAX_ATTACHMENT_TEXT) }
}

/**
 * Shape a triaged lead into what assessFit already knows how to read.
 *
 * The assessor was built for the proposal wizard, so this adapts rather than
 * duplicating it — one scoring model, one prompt, one place to tune.
 */
function toProposalExtraction(lead: LeadRow, attachmentText: string): ProposalExtraction {
  const scope = [lead.scope, attachmentText].filter(Boolean).join('\n\n')

  return {
    document_type: 'single_project_proposal',
    intake_summary: lead.summary ?? lead.title,
    developer_company: lead.sender_company
      ? {
          name: lead.sender_company,
          description: null,
          location: lead.location,
          website: null,
        }
      : null,
    projects: [
      {
        name: lead.title,
        description: lead.summary,
        sector: lead.sector,
        stage: 'pursuit',
        estimated_value: lead.estimated_value,
        contract_type: null,
        delivery_method: null,
        location: lead.location,
        client_entity: lead.sender_company,
        solicitation_number: lead.solicitation_number,
        award_date: null,
        ntp_date: null,
        substantial_completion_date: null,
        scope_of_work: scope || null,
        key_facts: lead.key_facts,
        confidence: lead.triage_confidence ?? 0.5,
      },
    ],
    parties: lead.sender_name
      ? [
          {
            name: lead.sender_name,
            company: lead.sender_company,
            role: 'Inbound contact',
            email: lead.sender_email,
            phone: lead.sender_phone,
            is_organization: false,
          },
        ]
      : [],
    entities: [],
    risks: [],
    compliance_requirements: lead.requirements,
    // The requirements list is the evidence; absence of the word is not proof
    // bonding is NOT required, so this stays null rather than false.
    bonding_required: lead.requirements.some((r) => /bond/i.test(r)) ? true : null,
    confidence: lead.triage_confidence ?? 0.5,
    field_confidences: {},
  }
}

/**
 * Score leads awaiting assessment until the time budget runs out.
 */
export async function scorePendingLeads(
  opts: { budgetMs?: number; maxLeads?: number; userId?: string } = {}
): Promise<ScoreProgress> {
  const budgetMs = opts.budgetMs ?? 20 * 60 * 1000
  const maxLeads = opts.maxLeads ?? Infinity
  const userId = opts.userId ?? SYSTEM_USER_ID
  const db = leadsDb()
  const threadsDb = sweepDb()
  const deadline = Date.now() + budgetMs

  const progress: ScoreProgress = {
    processed: 0,
    scored: 0,
    failed: 0,
    remaining: 0,
    attachmentsStaged: 0,
    outOfTime: false,
  }

  while (progress.processed < maxLeads) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    const { data, error } = await db
      .from('leads')
      .select('*')
      .eq('score_state', 'pending')
      .neq('status', 'spam')
      // Soonest bid first: if the run is cut short, the leads that are about to
      // close are the ones already scored.
      .order('bid_due_date', { ascending: true, nullsFirst: false })
      .limit(BATCH)

    if (error) throw new Error(`Could not load leads to score: ${error.message}`)
    const leads = (data ?? []) as LeadRow[]
    if (leads.length === 0) break

    for (const lead of leads) {
      if (Date.now() >= deadline || progress.processed >= maxLeads) {
        progress.outOfTime = Date.now() >= deadline
        break
      }

      try {
        const { data: threadData, error: threadErr } = await threadsDb
          .from('email_threads')
          .select('mailbox, gmail_thread_id')
          .eq('id', lead.thread_id)
          .maybeSingle()
        if (threadErr) throw new Error(threadErr.message)

        const thread = threadData as Pick<EmailThreadRow, 'mailbox' | 'gmail_thread_id'> | null
        const { attachments, text } = thread
          ? await stageAttachments(lead, thread)
          : { attachments: [] as LeadAttachment[], text: '' }
        progress.attachmentsStaged += attachments.length

        const fit = await assessFit(toProposalExtraction(lead, text), userId)

        const { error: updateErr } = await db
          .from('leads')
          .update({
            attachments,
            fit_score: fit?.fit_score ?? null,
            fit_recommendation: fit?.recommendation ?? null,
            fit_summary: fit?.summary ?? null,
            fit_strengths: fit?.strengths ?? [],
            fit_concerns: fit?.concerns ?? [],
            fit_gaps: fit?.gaps ?? [],
            fit_questions: fit?.key_questions ?? [],
            // No company profile means assessFit returns null. That is a
            // configuration gap, not a lead failure — keep the lead, record
            // that it could not be judged.
            score_state: 'scored',
            score_error: fit ? null : 'No company profile — fit could not be assessed.',
          })
          .eq('id', lead.id)
        if (updateErr) throw new Error(updateErr.message)

        progress.scored++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[leads/score] lead ${lead.id} failed:`, message)
        await db
          .from('leads')
          .update({ score_state: 'failed', score_error: message.slice(0, 500) })
          .eq('id', lead.id)
        progress.failed++
      }

      progress.processed++
    }
  }

  const { count } = await db
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('score_state', 'pending')
    .neq('status', 'spam')
  progress.remaining = count ?? 0

  return progress
}

/**
 * Mark open leads whose bid date has passed as expired, so the queue drains
 * itself rather than accumulating dead solicitations.
 */
export async function expireStaleLeads(): Promise<number> {
  const db = leadsDb()
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await db
    .from('leads')
    .update({ status: 'expired' })
    .in('status', ['new', 'reviewing'])
    .not('bid_due_date', 'is', null)
    .lt('bid_due_date', today)
    .select('id')

  if (error) throw new Error(`Could not expire stale leads: ${error.message}`)
  return data?.length ?? 0
}
