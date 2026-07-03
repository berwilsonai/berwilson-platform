import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  searchConversations,
  fetchConversationMessages,
  fetchMessageAttachments,
  RESEARCH_MAILBOXES,
  type ConversationSummary,
} from '@/lib/integrations/graph-search'
import { extractPlainText, type GraphAttachment } from '@/lib/integrations/microsoft-graph'
import { callGeminiWithFile } from '@/lib/ai/gemini'
import { analyzeEmailReport, EmailIntakeError } from '@/lib/email-ingestion/analyze'

/**
 * In-platform Email Research (replaces the external n8n workflow).
 *
 * Searches the connected Outlook mailboxes (RESEARCH_MAILBOXES — one OAuth
 * grant with delegated access) for threads matching a term, reads the
 * messages + attachments, assembles one markdown research report, and feeds
 * it through the shared email-ingestion analyzer. The result lands as a
 * pending session under Email Ingestion — nothing is created without the
 * human review/confirm step.
 *
 * A `running` session row is staged immediately so the run is visible under
 * Recent even if the user navigates away; it flips to `pending` on success or
 * `failed` (with the error stored on the row) on any failure path.
 */
export const maxDuration = 300

const MAX_CONVERSATIONS = 15
const MAX_MESSAGES_PER_THREAD = 30
const MAX_ATTACHMENTS_PER_THREAD = 3
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_MESSAGE_CHARS = 6_000
const MAX_REPORT_CHARS = 190_000 // stays under analyzeEmailReport's 200k cap

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

function fmtAddress(a?: { emailAddress: { name: string; address: string } }): string {
  if (!a) return 'Unknown'
  const { name, address } = a.emailAddress
  return name && name !== address ? `${name} <${address}>` : address
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

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

  const fail = async (status: number, message: string) => {
    if (sessionId) {
      await admin
        .from('email_intake_sessions')
        .update({ status: 'failed', extraction_result: { error: message } as never })
        .eq('id', sessionId)
    }
    return Response.json({ error: message }, { status })
  }

  try {
    // ── 1. Find matching conversations across all research mailboxes ─────────
    // Per-mailbox failures degrade gracefully (noted in the report) — a shared
    // mailbox the grant can't reach yet shouldn't sink the whole run.
    const mailboxNotes: string[] = []
    const searchResults = await Promise.all(
      RESEARCH_MAILBOXES.map(async (mailbox) => {
        try {
          return await searchConversations(searchTerm, { mailbox, sinceDays, maxConversations: MAX_CONVERSATIONS })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'search failed'
          mailboxNotes.push(
            /401|403|InvalidAuthenticationToken|Access is denied|ErrorAccessDenied|insufficient/i.test(message)
              ? `Mailbox ${mailbox} could not be searched — access denied. Reconnect Microsoft at /api/email/oauth to grant shared-mailbox access (Mail.Read.Shared).`
              : `Mailbox ${mailbox} could not be searched (${message.slice(0, 160)}).`
          )
          return null
        }
      })
    )

    if (searchResults.every((r) => r === null)) {
      const first = mailboxNotes[0] ?? ''
      if (/access denied|Reconnect/i.test(first)) {
        return fail(503, 'Outlook access was refused for every mailbox. Reconnect the Microsoft account at /api/email/oauth (the stored grant may predate the current scopes).')
      }
      console.error('[email-research] all mailbox searches failed:', mailboxNotes)
      return fail(502, 'Outlook search failed. If this persists, reconnect Microsoft at /api/email/oauth.')
    }

    const allConversations: ConversationSummary[] = searchResults
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .flatMap((r) => r.conversations)
      .sort((a, b) => b.latestReceived.localeCompare(a.latestReceived))
    const totalFound = searchResults.reduce((sum, r) => sum + (r?.totalFound ?? 0), 0)
    const searchTruncated = allConversations.length > MAX_CONVERSATIONS || searchResults.some((r) => r?.truncated)
    const conversations = allConversations.slice(0, MAX_CONVERSATIONS)

    if (conversations.length === 0) {
      return fail(404, `No email threads matched "${searchTerm}"${sinceDays ? ` in the last ${sinceDays} days` : ''} — try a different term or a wider time range.`)
    }

    // ── 2. Read each thread + analyze attachments ─────────────────────────────
    const sections: string[] = []
    const skippedNotes: string[] = [...mailboxNotes]
    // The same thread often lands in several mailboxes (info@ CC'd on tuaone's
    // conversation) — read each conversation once, and skip messages already
    // transcribed from another mailbox's copy.
    const seenConversations = new Set<string>()
    const seenMessageIds = new Set<string>()
    let threadNumber = 0

    for (const convo of conversations) {
      if (seenConversations.has(convo.conversationId)) continue
      seenConversations.add(convo.conversationId)

      let messages
      try {
        messages = await fetchConversationMessages(convo.conversationId, {
          mailbox: convo.mailbox,
          maxMessages: MAX_MESSAGES_PER_THREAD,
        })
      } catch (err) {
        skippedNotes.push(`Thread "${convo.subject}" could not be read (${err instanceof Error ? err.message.slice(0, 120) : 'error'}).`)
        continue
      }
      messages = messages.filter((m) => {
        const key = m.internetMessageId || m.id
        if (seenMessageIds.has(key)) return false
        seenMessageIds.add(key)
        return true
      })
      if (messages.length === 0) continue

      threadNumber++
      const first = messages[0].receivedDateTime.slice(0, 10)
      const last = messages[messages.length - 1].receivedDateTime.slice(0, 10)
      const lines: string[] = [
        `## Thread ${threadNumber}: ${convo.subject}`,
        `Mailbox: ${convo.mailbox} · ${messages.length} message(s), ${first} to ${last}`,
        '',
      ]

      for (const m of messages) {
        const to = (m.toRecipients ?? []).map(fmtAddress).join(', ')
        lines.push(`### ${m.receivedDateTime.slice(0, 16).replace('T', ' ')} — ${fmtAddress(m.from)}`)
        if (to) lines.push(`To: ${to}`)
        lines.push('')
        const text = extractPlainText(m.body ?? { contentType: 'text', content: m.bodyPreview ?? '' })
        lines.push(text.slice(0, MAX_MESSAGE_CHARS) + (text.length > MAX_MESSAGE_CHARS ? '\n[… message truncated]' : ''))
        lines.push('')
      }

      // Attachments: dedupe across the reply chain by name+size, cap per thread
      const seen = new Set<string>()
      const attachments: { attachment: GraphAttachment; messageId: string }[] = []
      for (const m of messages) {
        if (!m.hasAttachments) continue
        try {
          const atts = await fetchMessageAttachments(m.id, convo.mailbox)
          for (const a of atts) {
            if (a.isInline) continue
            const key = `${a.name}|${a.size}`
            if (seen.has(key)) continue
            seen.add(key)
            attachments.push({ attachment: a, messageId: m.id })
          }
        } catch (err) {
          skippedNotes.push(`Attachments on "${convo.subject}" could not be listed (${err instanceof Error ? err.message.slice(0, 120) : 'error'}).`)
        }
      }

      let analyzed = 0
      for (const { attachment: a } of attachments) {
        if (analyzed >= MAX_ATTACHMENTS_PER_THREAD) {
          lines.push(`### Attachment: ${a.name}`, 'Skipped — per-thread attachment limit reached.', '')
          continue
        }
        lines.push(`### Attachment: ${a.name} (${a.contentType}, ${Math.round(a.size / 1024)} KB)`)
        if (a.size > MAX_ATTACHMENT_BYTES) {
          lines.push('Skipped — larger than 10 MB.', '')
          continue
        }
        if (!ANALYZABLE_MIMES.has(a.contentType) || !a.contentBytes) {
          lines.push(`Skipped — ${a.contentType || 'unknown type'} is not analyzable (PDF and images only).`, '')
          continue
        }
        try {
          const result = await callGeminiWithFile<string>({
            systemPrompt: ATTACHMENT_SYSTEM,
            prompt: 'Extract the key content of this attachment.',
            file: { mimeType: a.contentType, dataBase64: a.contentBytes },
            userId: user.id,
            logLabel: `Email research attachment: ${a.name}`,
            promptVersion: 'email-attachment-1.0',
            jsonMode: false,
            maxTokens: 8192,
          })
          const text = typeof result.data === 'string' ? result.data.trim() : ''
          lines.push(text || '(no content extracted)', '')
          analyzed++
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
    const runDate = new Date().toISOString().slice(0, 10)
    const headerLines = [
      `# Email research: "${searchTerm}"`,
      `Generated ${runDate} · ${sections.length} thread(s) analyzed (of ${totalFound} found${searchTruncated ? ', newest kept' : ''}) · mailboxes: ${RESEARCH_MAILBOXES.join(', ')} · window: last ${sinceDays} days`,
    ]
    if (skippedNotes.length > 0) headerLines.push('', '## Skipped items', ...skippedNotes.map((n) => `- ${n}`))
    const header = headerLines.join('\n') + '\n\n'

    const kept: string[] = []
    let used = header.length
    let trimmed = 0
    for (const section of sections) {
      // Sections are newest-thread-first — once the budget is hit, older threads drop
      if (used + section.length > MAX_REPORT_CHARS) {
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

    // ── 4. Shared analyzer → the staged row becomes a pending review session ──
    const analysis = await analyzeEmailReport({
      rawText: report,
      label: label || searchTerm,
      userId: user.id,
      sessionId,
    })
    return Response.json({
      session_id: analysis.session_id,
      conversations_scanned: kept.length,
      total_found: totalFound,
      truncated: searchTruncated || trimmed > 0,
    })
  } catch (err) {
    if (err instanceof EmailIntakeError) {
      return fail(err.status, err.message)
    }
    console.error('[email-research] run failed:', err)
    return fail(500, 'The research run failed unexpectedly. Try again shortly.')
  }
}
