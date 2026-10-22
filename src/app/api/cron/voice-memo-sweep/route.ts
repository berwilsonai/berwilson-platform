/**
 * GET /api/cron/voice-memo-sweep
 *
 * Read the voice memos that have synced from the iPhone, transcribe them on
 * this machine, and let the eight mail phases file what turns out to be work.
 * Driven by com.berwilson.cron-voice-memo-sweep at :50 past the snapshot hours
 * — five minutes behind the notes sweep, because whisper and LM Studio share
 * one box and a latency measured while another sweep runs is measuring the
 * queue (§12).
 *
 * ⚠ THIS IS THE DOOR FOR AN IN-PERSON MEETING, AND IT IS A PHONE AND NOT A
 * BROWSER ON PURPOSE. Richard asked for a Record button at the top of the app;
 * on an iPhone, locking the screen or leaving Safari suspends the page and
 * WebAudio capture stops, so the button would lose exactly the 90-minute
 * meeting it was built for. Voice Memos holds a system background-audio
 * entitlement and records through a locked screen for hours.
 *
 * ⚠ EVERY MEMO IS READ, WHICH IS NOT THE NOTES RULE, AND THE SUMMARIZER IS WHY.
 * A note has no participants, so nominating a folder is the only signal there
 * is. A recording is speech, so the same pass that judges a text conversation
 * can judge it: a `noise` verdict discards the transcript, the chunks and the
 * copied audio, and skip-lists the memo so it is never copied or read again.
 * Richard's call, 10-14, in exchange for zero taps on the phone.
 *
 * `?dry=1` reads and reports and transcribes nothing.
 * `?limit=N` overrides the per-run ceiling, for a deliberate backfill.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runVoiceMemoSweep } from '@/lib/voicememos/sweep'
import { deferredResponse, interactiveRunInFlight } from '@/lib/ai/run-state'

/** A sqlite read, then whisper and one model pass per new recording, serially. */
export const maxDuration = 1800

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Stand aside while somebody is waiting on a Ber AI answer.
  //
  // LM Studio serves ONE request at a time (§2), so starting a model-heavy
  // pass now is added directly to the wait of whoever asked. This pass
  // checkpoints, so the next scheduled tick picks up where it left off and
  // nothing is lost by yielding. `?force=1` overrides.
  const waitingOnAnswer = await interactiveRunInFlight()
  if (waitingOnAnswer.busy && !request.nextUrl.searchParams.get('force')) {
    return NextResponse.json(deferredResponse('voice-memo-sweep', waitingOnAnswer))
  }


  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dry') === '1' || url.searchParams.get('dryRun') === '1'
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : undefined

  const result = await runVoiceMemoSweep({ dryRun, limit })

  // ⚠ The COUNT of what was discarded, never a word of it. A one-line summary
  // of a private conversation is still a description of a private conversation,
  // and the next one might be medical — which is also why the sweep nulls the
  // model's prose rather than keeping it for the log.
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
