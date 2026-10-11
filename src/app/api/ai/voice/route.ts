/**
 * POST /api/ai/voice — audio in, text out. Nothing else.
 *
 * WHY THIS EXISTS. The only transcription endpoint was
 * `/api/meetings/[id]/transcribe`, which requires a `document_id` already
 * attached to a meeting — correct for a recording that becomes a record, and
 * unusable for "what did I just say". This one stores nothing: the audio is
 * transcribed in memory and the buffer is dropped when the handler returns.
 *
 * ⚠ IT DELIBERATELY DOES NOT ANSWER THE QUESTION. Transcription and the agent
 * are two very different waits — whisper is ~25x realtime (measured: a 46s clip
 * in 1.8s) while an agent turn can reason for minutes behind a cron holding the
 * GPU. Splitting them means the reader sees their own words immediately and can
 * correct a misheard name before spending four minutes on the wrong question.
 * §12: split the instant local step from the slow one, and run the local step
 * first.
 *
 * Everything stays on the box: `transcribeAudio` spawns `afconvert` and
 * whisper.cpp, both local, which is the whole reason voice does not need an
 * external assistant.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { transcribeAudio, whisperAvailable, whisperEnabled } from '@/lib/ai/whisper'

export const maxDuration = 300

/**
 * A spoken question, not a recording. Three minutes of 16 kHz mono WAV is about
 * 5.8MB, so this is generous for the use and still bounded.
 */
const MAX_BYTES = 12 * 1024 * 1024

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Transcription is cheap but it is not free, and it holds a CPU for the
  // duration. 20/min is well past human speaking pace.
  const rl = checkRateLimit(`voice:${user.id}`, 20, 60_000)
  if (!rl.allowed) {
    return Response.json(
      { error: 'Too many recordings at once. Give it a moment.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    )
  }

  if (!whisperEnabled()) {
    return Response.json(
      { error: 'Voice is not configured on this server (WHISPER_BIN / WHISPER_MODEL are unset).' },
      { status: 501 }
    )
  }

  /**
   * ⚠ A PRESENT ENV VAR IS NOT A PRESENT FILE. `whisperEnabled()` only checks
   * that the paths are set; the model has gone missing on this box once before
   * and the only symptom was whisper-cli's opaque "failed to initialize whisper
   * context". Checking here turns that into a sentence naming the missing file.
   */
  const avail = await whisperAvailable()
  if (!avail.ok) {
    return Response.json(
      { error: `Voice is configured but not usable — missing: ${avail.missing.join(', ')}` },
      { status: 503 }
    )
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('audio')
  if (!(file instanceof File)) {
    return Response.json({ error: 'Send multipart/form-data with an "audio" file.' }, { status: 400 })
  }
  if (file.size === 0) {
    return Response.json({ error: 'The recording was empty.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `That recording is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is ${MAX_BYTES / 1024 / 1024}MB.` },
      { status: 413 }
    )
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const started = Date.now()
    const text = await transcribeAudio(buffer, file.name || 'question.wav')
    const transcript = text.trim()

    if (!transcript) {
      return Response.json(
        { error: 'Nothing was recognised in that recording. Try again, a little closer to the microphone.' },
        { status: 422 }
      )
    }

    return Response.json({ text: transcript, latencyMs: Date.now() - started })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/ai/voice] transcription failed:', message)
    return Response.json({ error: `Transcription failed: ${message}` }, { status: 500 })
  }
}
