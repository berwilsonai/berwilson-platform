import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { searchThreads, renderThread } from '@/lib/integrations/gmail-search'
import {
  fetchAttachmentBytes,
  isGoogleConfigured,
  MAILBOXES,
  type MailAttachmentRef,
} from '@/lib/integrations/google-workspace'
import { callGeminiWithFile } from '@/lib/ai/gemini'
import { analyzeEmailReport, EmailIntakeError, maxInputChars } from '@/lib/email-ingestion/analyze'
import {
  STAGING_FOLDER,
  removeStagedFiles,
  sanitizeFileName,
  type StagedAttachment,
} from '@/lib/email-ingestion/attachments'

/**
 * Targeted Email Research — search the connected Gmail mailboxes for a term,
 * read the matching threads + attachments, and stage ONE pending review session.
 *
 * This is the "I need everything about X, now" path. The whole-mailbox backfill
 * is a different thing entirely and lives under /api/email-sweep.
 *
 * A `running` session row is staged immediately so the run is visible under
 * Recent even if the user navigates away; it flips to `pending` on success or
 * `failed` (with the error stored on the row) on any failure path.
 */
export const maxDuration = 300

const MAX_THREADS = 15
const MAX_ATTACHMENTS_PER_THREAD = 3
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

// Staging (files kept for the review screen's attachment picker) is wider than
// AI analysis: every non-inline file type qualifies, bigger size cap.
const MAX_STAGED_BYTES = 25 * 1024 * 1024
const MAX_STAGED_FILES = 30

const ANALYZABLE_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

const ATTACHMENT_SYSTEM = `You are an analyst extracting intelligence from an email attachment for a construction & development executive.
Extract the key content as plain text: people and organizations named, dollar figures, dates, deal or contract terms, decisions, obligations, and anything a deal principal would need to know.
Be thorough but do not pad. Output ONLY the extracted content.`

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isGoogleConfigured()) {
    return Response.json(
      { error: 'Google Workspace is not configured — see deploy/google-workspace-setup.md.' },
      { status: 503 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const searchTerm = typeof body.searchTerm === 'string' ? body.searchTerm.trim() : ''
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  const sinceDays = Number(body.sinceDays) > 0 ? Number(body.sinceDays) : 365

  if (!searchTerm) {
    return Response.json({ error: 'A search term is required.' }, { status: 400 })
  }

  // Stage a visible `running` session immediately — the server finishes the run
  // even if the browser leaves, and this row is how the user finds it again.
  const admin = createAdminClient()
  const { data: staged, error: stageErr } = await admin
    .from('email_intake_sessions')
    .insert({
      user_id: user.id,
      status: 'running',
      label: label || searchTerm,
      extraction_result: {} as never,
    })
    .select('id')
    .single()
  if (stageErr) console.error('[email-research] could not stage running session:', stageErr)
  const sessionId = staged?.id

  // Attachments staged to storage during the run (declared here so failure
  // paths can clean them up — a failed session offers no review to pick from).
  const stagedAttachments: StagedAttachment[] = []
  const stagedKeys = new Set<string>()

  const fail = async (status: number, message: string) => {
    await removeStagedFiles(admin, stagedAttachments)
    if (sessionId) {
      await admin
        .from('email_intake_sessions')
        .update({ status: 'failed', extraction_result: { error: message } as never })
        .eq('id', sessionId)
    }
    return Response.json({ error: message }, { status })
  }

  try {
    // ── 1. Find matching threads across all mailboxes ────────────────────────
    // Per-mailbox failures degrade into report notes — one unreachable mailbox
    // shouldn't sink the whole run.
    const search = await searchThreads(searchTerm, { sinceDays, maxThreads: MAX_THREADS })

    if (search.threads.length === 0) {
      if (search.notes.length > 0) {
        console.error('[email-research] all mailbox searches failed:', search.notes)
        return fail(
          502,
          `Gmail search failed. ${search.notes[0]?.slice(0, 200) ?? ''} Check the Google connection on /settings/health.`
        )
      }
      return fail(
        404,
        `No email threads matched "${searchTerm}"${sinceDays ? ` in the last ${sinceDays} days` : ''} — try a different term or a wider time range.`
      )
    }

    // ── 2. Render each thread + analyze attachments ───────────────────────────
    const sections: string[] = []
    const skippedNotes: string[] = [...search.notes]

    for (const [index, thread] of search.threads.entries()) {
      const lines = [renderThread(thread, { heading: `## Thread ${index + 1}: ${thread.subject}` })]

      // Dedupe attachments across the reply chain by name+size.
      const seen = new Set<string>()
      const attachments: MailAttachmentRef[] = []
      for (const m of thread.messages) {
        for (const a of m.attachments) {
          if (a.isInline) continue
          const key = `${a.name}|${a.size}`
          if (seen.has(key)) continue
          seen.add(key)
          attachments.push(a)
        }
      }

      let analyzed = 0
      for (const a of attachments) {
        const globalKey = `${a.name}|${a.size}`
        const wantAnalysis =
          analyzed < MAX_ATTACHMENTS_PER_THREAD &&
          a.size <= MAX_ATTACHMENT_BYTES &&
          ANALYZABLE_MIMES.has(a.mimeType)
        const wantStaging =
          Boolean(sessionId) &&
          a.size <= MAX_STAGED_BYTES &&
          !stagedKeys.has(globalKey) &&
          stagedAttachments.length < MAX_STAGED_FILES

        // Gmail — unlike Graph — never returns bytes inline, so downloading is
        // an explicit round trip. Skip it entirely when neither path wants the
        // file: on a big thread that saves far more than it costs.
        let bytes: string | null = null
        if (wantAnalysis || wantStaging) {
          try {
            bytes = await fetchAttachmentBytes(thread.mailbox, a.messageId, a.attachmentId)
          } catch (err) {
            skippedNotes.push(
              `Attachment "${a.name}" could not be downloaded (${
                err instanceof Error ? err.message.slice(0, 120) : 'error'
              }).`
            )
          }
        }

        if (wantStaging && bytes) {
          const path = `${STAGING_FOLDER}/${sessionId}/${stagedAttachments.length + 1}_${sanitizeFileName(a.name)}`
          const { error: uploadErr } = await admin.storage
            .from('documents')
            .upload(path, Buffer.from(bytes, 'base64'), {
              contentType: a.mimeType || 'application/octet-stream',
              upsert: false,
            })
          if (uploadErr) {
            console.error(`[email-research] could not stage attachment ${a.name}:`, uploadErr.message)
          } else {
            stagedKeys.add(globalKey)
            stagedAttachments.push({
              name: a.name,
              mime_type: a.mimeType || null,
              size_bytes: a.size,
              storage_path: path,
              thread_subject: thread.subject,
              analyzed: false,
            })
          }
        }

        if (analyzed >= MAX_ATTACHMENTS_PER_THREAD) {
          lines.push(`### Attachment: ${a.name}`, 'Not analyzed — per-thread attachment limit reached (file kept for review).', '')
          continue
        }
        lines.push(`### Attachment: ${a.name} (${a.mimeType}, ${Math.round(a.size / 1024)} KB)`)
        if (a.size > MAX_ATTACHMENT_BYTES) {
          lines.push('Not analyzed — larger than 10 MB.', '')
          continue
        }
        if (!ANALYZABLE_MIMES.has(a.mimeType)) {
          lines.push(`Not analyzed — ${a.mimeType || 'unknown type'} is not analyzable (PDF and images only; file kept for review).`, '')
          continue
        }
        if (!bytes) {
          lines.push('Not analyzed — the file could not be downloaded.', '')
          continue
        }

        try {
          const result = await callGeminiWithFile<string>({
            systemPrompt: ATTACHMENT_SYSTEM,
            prompt: 'Extract the key content of this attachment.',
            file: { mimeType: a.mimeType, dataBase64: bytes },
            userId: user.id,
            logLabel: `Email research attachment: ${a.name}`,
            promptVersion: 'email-attachment-1.0',
            jsonMode: false,
            maxTokens: 8192,
          })
          const text = typeof result.data === 'string' ? result.data.trim() : ''
          lines.push(text || '(no content extracted)', '')
          analyzed++
          const stagedRow = stagedAttachments.find((s) => `${s.name}|${s.size_bytes}` === globalKey)
          if (stagedRow) stagedRow.analyzed = true
        } catch (err) {
          lines.push(`Extraction failed (${err instanceof Error ? err.message.slice(0, 120) : 'error'}).`, '')
        }
      }

      sections.push(lines.join('\n'))
    }

    if (sections.length === 0) {
      return fail(502, 'Matching threads were found but none could be read. Try again shortly.')
    }

    // ── 3. Assemble the report (trim oldest threads first if over budget) ─────
    // The cap follows the active AI provider — the local model has far less
    // context than Gemini, so the same report has to be trimmed harder.
    const maxReportChars = Math.floor(maxInputChars() * 0.95)
    const runDate = new Date().toISOString().slice(0, 10)
    const headerLines = [
      `# Email research: "${searchTerm}"`,
      `Generated ${runDate} · ${sections.length} thread(s) analyzed (of ${search.totalFound} found${search.truncated ? ', newest kept' : ''}) · mailboxes: ${MAILBOXES.join(', ')} · window: last ${sinceDays} days`,
    ]
    if (skippedNotes.length > 0) headerLines.push('', '## Skipped items', ...skippedNotes.map((n) => `- ${n}`))
    const header = headerLines.join('\n') + '\n\n'

    const kept: string[] = []
    let used = header.length
    let trimmed = 0
    for (const section of sections) {
      // Sections are newest-thread-first — once the budget is hit, older threads drop
      if (used + section.length > maxReportChars) {
        trimmed++
        continue
      }
      kept.push(section)
      used += section.length + 2
    }
    const report =
      header +
      kept.join('\n\n') +
      (trimmed > 0 ? `\n\n---\n${trimmed} older thread(s) omitted to fit the analysis size limit.` : '')

    // The record's permanent document keeps every thread, including the ones
    // trimmed out of the model's input.
    const document = header + sections.join('\n\n')

    // ── 3b. Record the staged attachments on the session ─────────────────────
    if (sessionId && stagedAttachments.length > 0) {
      const { error: attachErr } = await admin
        .from('email_intake_sessions')
        .update({ staged_attachments: stagedAttachments as unknown as never })
        .eq('id', sessionId)
      if (attachErr) {
        console.error('[email-research] staged_attachments not recorded (migration applied?):', attachErr.message)
      }
    }

    // ── 4. Shared analyzer → the staged row becomes a pending review session ──
    const analysis = await analyzeEmailReport({
      rawText: report,
      documentText: document,
      label: label || searchTerm,
      userId: user.id,
      sessionId,
    })
    return Response.json({
      session_id: analysis.session_id,
      conversations_scanned: kept.length,
      total_found: search.totalFound,
      truncated: search.truncated || trimmed > 0,
    })
  } catch (err) {
    if (err instanceof EmailIntakeError) {
      return fail(err.status, err.message)
    }
    console.error('[email-research] run failed:', err)
    return fail(500, 'The research run failed unexpectedly. Try again shortly.')
  }
}
