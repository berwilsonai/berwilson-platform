/**
 * GET /api/cron/pepper-reply
 *
 * Pepper answers a question you emailed her, in the thread you asked it in.
 *
 * Reply to any of her emails from a phone — "when does Steelton close?", "what
 * is open with Tensor?" — and this picks it up on the next tick, looks it up
 * over the agent's read-only tools, and replies into the same conversation from
 * the mailbox it arrived in.
 *
 * ⚠ ON `moose@`/`tuaone@`, NOT `info@`. The reasoning is in the header of
 * src/lib/pepper/inbound.ts: every mailbox already holds `gmail.send`, only
 * `info@` holds the write scopes nothing here needs, `info@` is swept once a
 * day by the LEAD pipeline and would score a question as a sales lead, and
 * Richard's own direction is that `info@` is junk while every deal lives in the
 * other two. No re-consent is needed from anybody.
 *
 * ⚠ SENDER-ALLOWLISTED BY ADDRESS, failing closed, with silence for anybody
 * else. See the inbound header — a reply to a stranger is an outbound egress
 * hole, not a courtesy.
 *
 * ⚠ TIMING. One agent turn per question, up to twelve tool rounds, on a box
 * that serves ONE model request at a time. So this runs through the working day
 * at a 15-minute interval, and `MAX_PER_MEMBER` caps the work per tick — but it
 * deliberately does NOT run in the 05:30–07:00 block where the chase, the
 * curator, the brief, the note and the digest already queue behind each other.
 */

import { NextRequest, NextResponse } from 'next/server'
import { OUTBOUND, isHeld } from '@/lib/notify/policy'
import { findQuestions } from '@/lib/pepper/inbound'
import { answerQuestion } from '@/lib/pepper/answer'

/**
 * One agent turn per question, sequential, each able to run twelve tool rounds.
 * Matches the agent's own ceiling rather than guessing a smaller one.
 */
export const maxDuration = 1800

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dry') === '1'

  // ⚠ BEFORE `findQuestions`, SO A QUESTION IS NOT CONSUMED WHILE SHE CANNOT
  // ANSWER IT. The inbound scan is how a thread gets marked as handled; running
  // it under a held outbound channel would read the question, record it as
  // dealt with, and reply to nobody — which is worse than not listening. Held
  // 2026-10-21 (src/lib/notify/policy.ts).
  if (isHeld('pepper_answer')) {
    return NextResponse.json({
      ok: true,
      held: 'pepper_answer',
      detail: OUTBOUND.pepper_answer.held,
    })
  }

  const { questions, scanned, error } = await findQuestions()
  if (error) {
    // A roster that cannot be read means an empty allowlist, which answers
    // nobody — the safe outcome, reported rather than retried.
    return NextResponse.json({ ok: false, error, scanned, answered: 0 }, { status: 200 })
  }

  const results = []
  let answered = 0
  let failed = 0

  // Sequential, and not a preference: LM Studio serves one request at a time
  // and nothing in this repo queues, so two turns at once is two turns waiting.
  for (const q of questions) {
    const result = await answerQuestion(q, { dryRun })
    if (result.sent) answered += 1
    else if (result.error) failed += 1
    results.push(result)
  }

  return NextResponse.json({
    ok: failed === 0,
    dryRun,
    /** Threads she had sent to and re-read. Not the size of any mailbox. */
    scanned,
    questions: questions.length,
    answered,
    failed,
    results,
  })
}
