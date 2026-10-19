/**
 * GET /api/cron/drive-audio-sweep
 *
 * Read the recordings dropped in the nominated Drive folder, transcribe them on
 * this machine, and let the eight mail phases file what they turn out to be.
 * Driven by com.berwilson.cron-drive-audio-sweep, hourly in business hours at
 * :35 — clear of the hourly email sweep and of the three local snapshot sweeps
 * at :40/:45/:50, because whisper and LM Studio share one box and a latency
 * measured while another sweep runs is measuring the queue (§12).
 *
 * ⚠ THIS IS THE DOOR FOR A RECORDER THAT IS NOT AN APPLE DEVICE. An iPhone call
 * recording arrives through Apple Notes and an in-person meeting through the
 * Voice Memos store; both are copied by `bw-snapshot` and neither transport can
 * be reached by a hardware recorder. Exporting to Drive can, and until now
 * nothing in the platform read audio from Drive at all.
 *
 * ⚠ THE FOLDER IS THE GATE, NOT A CLASSIFIER. Dropping a file in there is a
 * human filing decision, the same control model as a nominated Notes folder or
 * a knowledge folder (§7). A `noise` verdict still discards the TEXT, because
 * the prefix is in `LOCAL_THREAD_PREFIXES`; the FILE is never touched, because
 * it is not ours to delete.
 *
 * `?dry=1` lists what it would read and transcribes nothing.
 * `?limit=N` overrides the per-run ceiling, for a deliberate backfill.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runDriveAudioSweep } from '@/lib/driveaudio/sweep'

/** A Drive listing, then a download + whisper + one model pass per file, serially. */
export const maxDuration = 1800

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dry') === '1' || url.searchParams.get('dryRun') === '1'
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : undefined

  const result = await runDriveAudioSweep({ dryRun, limit })

  // ⚠ The discarded recordings are reported by NAME here and by bare count in
  // the voice-memo route, and the difference is deliberate: that name is iOS's
  // on somebody's private life, this one is a file name Richard typed on a file
  // he deliberately filed — and the remedy needs it, because the only thing
  // that undoes a wrong verdict is knowing which file to upload a copy of.
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
