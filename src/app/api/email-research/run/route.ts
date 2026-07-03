import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchConversations, fetchConversationMessages } from '@/lib/integrations/graph-search'
import { fetchAttachments, extractPlainText, type GraphAttachment } from '@/lib/integrations/microsoft-graph'
import { callGeminiWithFile } from '@/lib/ai/gemini'
import { analyzeEmailReport, EmailIntakeError } from '@/lib/email-ingestion/analyze'

/**
 * In-platform Email Research (replaces the external n8n workflow).
 *
 * Searches the connected Outlook mailbox for threads matching a term, reads
 * the messages + attachments, assembles one markdown research report, and
 * feeds it through the shared email-ingestion analyzer. The result lands as a
 * pending session under Email Ingestion — nothing is created without the
 * human review/confirm step.
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

  // ── 1. Find matching conversations ──────────────────────────────────────────
  let search
  try {
    search = await searchConversations(searchTerm, { sinceDays, maxConversations: MAX_CONVERSATIONS })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Graph search failed'
    if (/No stored tokens/i.test(message)) {
      return Response.json(
        { error: 'Microsoft account not connected — run the email OAuth flow (Settings → connect Outlook) and try again.' },
        { status: 503 }
      )
    }
    if (/401|403|InvalidAuthenticationToken|insufficient/i.test(message)) {
      return Response.json(
        { error: 'Outlook access was refused. Reconnect the Microsoft account (the stored grant may predate Mail.Read).' },
        { status: 503 }
      )
    }
    console.error('[email-research] search failed:', message)
    return Response.json({ error: 'Outlook search failed. Try again shortly.' }, { status: 502 })
  }

  if (search.conversations.length === 0) {
    return Response.json(
      { error: `No email threads matched "${searchTerm}"${sinceDays ? ` in the last ${sinceDays} days` : ''} — try a different term or a wider time range.` },
      { status: 404 }
    )
  }

  // ── 2. Read each thread + analyze attachments ───────────────────────────────
  const sections: string[] = []
  const skippedNotes: string[] = []

  for (const [i, convo] of search.conversations.entries()) {
    let messages
    try {
      messages = await fetchConversationMessages(convo.conversationId, { maxMessages: MAX_MESSAGES_PER_THREAD })
    } catch (err) {
      skippedNotes.push(`Thread "${convo.subject}" could not be read (${err instanceof Error ? err.message.slice(0, 120) : 'error'}).`)
      continue
    }
    if (messages.length === 0) continue

    const first = messages[0].receivedDateTime.slice(0, 10)
    const last = messages[messages.length - 1].receivedDateTime.slice(0, 10)
    const lines: string[] = [
      `## Thread ${i + 1}: ${convo.subject}`,
      `${messages.length} message(s), ${first} to ${last}`,
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
        const atts = await fetchAttachments(m.id)
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
    return Response.json({ error: 'Matching threads were found but none could be read. Try again shortly.' }, { status: 502 })
  }

  // ── 3. Assemble the report (trim oldest threads first if over budget) ───────
  const runDate = new Date().toISOString().slice(0, 10)
  const headerLines = [
    `# Email research: "${searchTerm}"`,
    `Generated ${runDate} · ${sections.length} thread(s) analyzed (of ${search.totalFound} found${search.truncated ? ', newest kept' : ''}) · window: last ${sinceDays} days`,
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

  // ── 4. Shared analyzer → pending session under Email Ingestion ──────────────
  try {
    const analysis = await analyzeEmailReport({
      rawText: report,
      label: label || searchTerm,
      userId: user.id,
    })
    return Response.json({
      session_id: analysis.session_id,
      conversations_scanned: kept.length,
      total_found: search.totalFound,
      truncated: search.truncated || trimmed > 0,
    })
  } catch (err) {
    if (err instanceof EmailIntakeError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    console.error('[email-research] analyze failed:', err)
    return Response.json({ error: 'The report was assembled but analysis failed. Try again shortly.' }, { status: 500 })
  }
}
