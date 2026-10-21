/**
 * Answer one question, over the agent's read-only tools.
 *
 * ⚠ READ-ONLY BY CONSTRUCTION, NOT BY A FLAG. Audited 2026-10-15: there is not
 * one `.insert(`, `.update(`, `.upsert(` or `.delete(` across `agent-tools.ts`
 * or `agent-tools-modules.ts` — all 43 tools read. So there is no "read-only
 * mode" to switch on here and nothing to switch off; a tool that mutates would
 * have to be written first, and when one is, it must not be reachable from this
 * path. That is the standing constraint on this file.
 *
 * ⚠ AND IT IS BLIND TO A PROTECTED DEAL WHOEVER ASKS. `executeToolCall` calls
 * `hiddenProjectIds(null)` and post-filters with `scrubHiddenProjects`, which
 * is viewer-independent by design (`security/confidential.ts` takes no request
 * and no cookies so crons can import it). Containment, not access — §12: the
 * one of those two that can never be unlocked after the fact is the one that
 * leaves the box, and an emailed answer leaves the box.
 *
 * ⚠ IT IMPORTS `runAgent` RATHER THAN CALLING `/api/ai/agent`. That route does
 * `supabase.auth.getUser()` and 401s without a session cookie, which a cron
 * does not have; and §12 holds that agent tools never fetch the app's own HTTP
 * routes. The library is cookie-free and uses the admin client already.
 */

import { randomUUID } from 'node:crypto'
import { runAgent } from '@/lib/ai/agent'
import { SYSTEM_USER_ID } from '@/lib/system-user'
import { notify } from '@/lib/notify'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PepperQuestion } from './inbound'

/**
 * What she is told about the job, on top of the agent's own persona.
 *
 * Deliberately short. The agent already carries the Construction Executive
 * persona and the company profile; this only says who is asking, through which
 * channel, and what the channel cannot do.
 */
function framing(q: PepperQuestion): string {
  return [
    `${q.caller.member.name} has replied to one of your emails to ask you this.`,
    'Answer it directly, in two or three sentences unless the question genuinely needs more.',
    'You are replying by email from their own mailbox, so write it as a reply — no greeting, no sign-off, no subject line.',
    'Use your tools to look things up. If the records do not say, say that plainly and say what would answer it.',
    'You cannot change anything: you can only read. If they have asked you to DO something — settle a commitment, move a date, tick a task — say you cannot do that yet and tell them where to do it themselves.',
    '',
    'Their question:',
    q.question,
  ].join('\n')
}

export interface AnsweredQuestion {
  member: string
  question: string
  answer: string
  toolCalls: number
  sent: boolean
  error?: string
}

/**
 * Answer one question and send the reply into its own thread.
 *
 * The conversation is persisted under a fresh id so the exchange is auditable
 * on `/intel` like any other — and every model call lands in `ai_queries`
 * through `callGemini`, which is the standing contract (§2).
 */
export async function answerQuestion(
  q: PepperQuestion,
  opts: { dryRun?: boolean } = {}
): Promise<AnsweredQuestion> {
  const base: AnsweredQuestion = {
    member: q.caller.member.name,
    question: q.question.slice(0, 200),
    answer: '',
    toolCalls: 0,
    sent: false,
  }

  let answer: string
  let toolCalls = 0
  try {
    const result = await runAgent(framing(q), {
      userId: SYSTEM_USER_ID,
      conversationId: randomUUID(),
    })
    answer = (result.content ?? '').trim()
    toolCalls = result.toolCalls?.length ?? 0
  } catch (err) {
    return { ...base, error: `the agent failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  // ⚠ AN EMPTY ANSWER IS NOT SENT. §12: an agentic loop that falls out of the
  // bottom shipped the NARRATION as the answer once; the mirror of that is
  // mailing an empty reply, which reads as Pepper having nothing to say about a
  // question she simply failed on. Reported instead, so the log shows it.
  if (!answer) {
    return { ...base, toolCalls, error: 'the agent returned nothing, so nothing was sent' }
  }

  if (opts.dryRun) return { ...base, answer, toolCalls }

  const result = await notify({
    channel: 'email',
    kind: 'pepper_answer',
    to: q.caller.member.email,
    subject: q.subject,
    html: asHtml(answer),
    // Her own voice, from the mailbox the question arrived in — so the reply
    // lands in the conversation rather than as a loose new message.
    from: q.mailbox,
    fromName: 'Pepper',
    threadId: q.threadId,
    inReplyTo: q.inReplyTo,
  })

  if (!result.ok) {
    return { ...base, answer, toolCalls, error: result.error ?? 'the send failed' }
  }

  await logAnswer(q, answer)
  return { ...base, answer, toolCalls, sent: true }
}

/**
 * Record the exchange on `notification_log`.
 *
 * ⚠ WITH ITS OWN `kind`, AND WITH THE THREAD ID. Two reasons: the health page
 * watches channels by kind and a channel nobody watches is the failure mode
 * that already happened twice here (the morning note until 10-08, the text
 * until 10-15); and the row's `gmail_thread_id` keeps the thread in the sent
 * set, so a follow-up question on the same conversation is still recognised
 * after the original note falls out of the window.
 */
async function logAnswer(q: PepperQuestion, answer: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('notification_log')
    .insert({
      team_member_id: q.caller.member.id,
      channel: 'email',
      kind: 'pepper_answer',
      sent_date: new Date().toISOString().slice(0, 10),
      status: 'sent',
      task_count: answer.length,
      gmail_thread_id: q.threadId,
    })
  if (error) {
    // Loud, not thrown: the answer HAS been sent, and failing here would have
    // the caller believe it had not.
    console.error(`[pepper-answer] could not log the reply: ${error.message}`)
  }
}

/** Minimal HTML. The agent writes prose, not markup. */
function asHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827;white-space:pre-wrap;">${escaped}</div>`
}
