/**
 * GET /api/cron/daily-digest
 *
 * The morning read: everything that arrived since yesterday, ranked, with what
 * is coming due, posted to the Google Chat space and stored in BI.
 *
 * WHY CHAT IS THE DELIVERY AND THE PLATFORM IS THE ARCHIVE. Ber Intelligence is
 * tailnet-only and most of the company cannot reach it. A briefing that only
 * exists behind a login the reader does not have is a briefing nobody reads —
 * this platform has already learned that twice: the portfolio brief spent weeks
 * being written to a table whose only reader was a /briefs page that did not
 * exist, and the dashboard panel loaded from localStorage so the cron's brief
 * appeared only in a browser that had personally generated one.
 *
 * Runs weekdays. A digest that fires on Sunday over 16-28 threads of nothing
 * teaches people to ignore Monday's, so the weekend is deliberately silent and
 * Monday reaches back across it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini } from '@/lib/ai/gemini'
import { assembleDigest, digestIsEmpty } from '@/lib/digest/assemble'
import { renderDigestInput } from '@/lib/digest/render'
import {
  DAILY_DIGEST_SYSTEM_PROMPT,
  DAILY_DIGEST_PROMPT_VERSION,
} from '@/lib/digest/prompt'
import { markdownToChatText } from '@/lib/notify/broadcast-brief'
import { notify } from '@/lib/notify'
import { isChatConfigured } from '@/lib/notify/chat'
import { SYSTEM_USER_ID } from '@/lib/system-user'

/**
 * One long local-model call. Matches the weekly brief's ceiling and sits above
 * LOCAL_AI_TIMEOUT_MS, so a genuinely stalled model is caught by its own guard
 * rather than by this — and launchd records the real outcome instead of a
 * client-side cut-off on a run that actually succeeded.
 */
export const maxDuration = 1800

/** Chat rejects oversized messages; a trimmed digest beats one that never posts. */
const MAX_CHAT_CHARS = 3800

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const force = url.searchParams.get('force') === '1'
  const dryRun = url.searchParams.get('dry') === '1'

  const supabase = createAdminClient()
  const now = new Date()

  // One digest per day. A retry, a hand-triggered run, or a launchd double-fire
  // must not post the same morning twice — two digests in a space is how a
  // channel starts getting muted.
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  if (!force && !dryRun) {
    const { data: existing } = await supabase
      .from('stored_briefs')
      .select('id')
      .eq('brief_type', 'daily_digest')
      .gte('created_at', dayStart.toISOString())
      .limit(1)
    if (existing && existing.length > 0) {
      return NextResponse.json({ message: 'Digest already sent today', brief_id: existing[0].id })
    }
  }

  const data = await assembleDigest(now)

  // Nothing to say is a real outcome, not a failure. Posting "no updates" every
  // quiet morning is precisely the noise that costs a channel its readership.
  if (digestIsEmpty(data)) {
    return NextResponse.json({ message: 'Nothing to report', skipped: true, window: data.window.label })
  }

  const input = renderDigestInput(data)

  const { data: composed, model, latencyMs } = await callGemini<string>({
    task: 'daily-digest',
    systemPrompt: DAILY_DIGEST_SYSTEM_PROMPT,
    userMessage: input,
    userId: SYSTEM_USER_ID,
    promptVersion: DAILY_DIGEST_PROMPT_VERSION,
    // Prose, not JSON — jsonMode would make the model wrap a markdown document
    // in a string field and escape every newline in it.
    jsonMode: false,
  })

  const markdown = typeof composed === 'string' ? composed.trim() : String(composed ?? '').trim()
  if (!markdown) {
    return NextResponse.json({ error: 'Model returned an empty digest' }, { status: 502 })
  }

  const title = `Daily Digest — ${now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Denver',
  })}`

  if (dryRun) {
    return NextResponse.json({ dryRun: true, title, markdown, inputChars: input.length })
  }

  // Stored BEFORE it is delivered, so a Chat outage costs the post and never
  // the digest itself. The stored copy is what the dashboard reads.
  const { data: stored, error: storeErr } = await supabase
    .from('stored_briefs')
    .insert({
      brief_type: 'daily_digest',
      title,
      content: markdown,
      model_used: model,
      latency_ms: latencyMs,
      metadata: {
        threads: data.threads.length,
        leads: data.leads.length,
        commitments_owed: data.commitmentsOwed.length,
        commitments_awaited: data.commitmentsAwaited.length,
        bids_closing: data.bidsClosing.length,
        notes: data.notes,
      },
    })
    .select('id')
    .single()

  if (storeErr) {
    console.error('[daily-digest] could not store the digest:', storeErr.message)
  }

  let delivery: { ok: boolean; skipped?: boolean; error?: string } = { ok: false, skipped: true }
  if (isChatConfigured()) {
    let text = markdownToChatText(markdown)
    if (text.length > MAX_CHAT_CHARS) {
      text = `${text.slice(0, MAX_CHAT_CHARS).trimEnd()}\n\n_…trimmed. Open Ber Intelligence for the full digest._`
    }
    const appUrl = process.env.APP_URL?.replace(/\/$/, '')
    if (appUrl) {
      text += `\n\n<${appUrl}/decide|Open the Decide queue> · <${appUrl}/dashboard|Dashboard>`
    }
    delivery = await notify({
      channel: 'chat',
      to: 'updates',
      subject: title,
      html: '',
      text,
      // One thread per day, so the space shows a running series of mornings
      // rather than a flat wall that buries yesterday's.
      threadKey: `digest-${now.toISOString().slice(0, 10)}`,
    })
  }

  return NextResponse.json({
    ok: true,
    brief_id: stored?.id ?? null,
    title,
    delivery,
    counts: {
      threads: data.threads.length,
      leads: data.leads.length,
      commitmentsOwed: data.commitmentsOwed.length,
      commitmentsAwaited: data.commitmentsAwaited.length,
      bidsClosing: data.bidsClosing.length,
      meetings: data.meetings.length,
    },
    notes: data.notes,
  })
}
