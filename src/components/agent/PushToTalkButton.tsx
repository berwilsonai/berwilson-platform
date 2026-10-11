'use client'

/**
 * Talk to Ber Intelligence.
 *
 * Tap to start, tap to stop. Deliberately a toggle rather than press-and-hold:
 * a held button cannot be reached from a keyboard, and holding a phone button
 * steady through a twenty-second question is worse than two taps.
 *
 * ⚠ IT FILLS THE BOX, IT DOES NOT SEND. The transcript lands in the composer so
 * a misheard name can be fixed before an agent turn that may run for minutes
 * (§12: split the instant local step from the slow remote one, and run the
 * local step first). Auto-sending would spend four minutes on the wrong
 * question and give the reader no way to stop it.
 *
 * Everything here is local: `startRecording` encodes WAV in the browser and
 * `/api/ai/voice` transcribes with whisper.cpp on this machine. No audio and no
 * transcript ever leaves the box.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import { startRecording, type Recorder } from '@/lib/audio/wav'

const noopSubscribe = () => () => {}

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing'

interface PushToTalkButtonProps {
  /** Receives the recognised text. The caller decides what to do with it. */
  onTranscript: (text: string) => void
  /** Surfaced to the caller's own error area rather than invented here. */
  onError?: (message: string) => void
  /** Recording while a turn is in flight would queue behind it on one GPU. */
  disabled?: boolean
  className?: string
}

export default function PushToTalkButton({
  onTranscript,
  onError,
  disabled,
  className,
}: PushToTalkButtonProps) {
  // Hydration-safe: false on the server, real value on the client. An iPhone on
  // plain http would report no mediaDevices at all — the platform is https over
  // tailscale serve, so this is really only a very old browser check.
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    () => false
  )

  const [phase, setPhase] = useState<Phase>('idle')
  const [level, setLevel] = useState(0)
  const recorderRef = useRef<Recorder | null>(null)

  // Release the microphone if the dock closes mid-recording. Without this the
  // browser keeps showing the recording indicator after the panel is gone.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel()
      recorderRef.current = null
    }
  }, [])

  const fail = useCallback(
    (message: string) => {
      recorderRef.current = null
      setPhase('idle')
      setLevel(0)
      onError?.(message)
    },
    [onError]
  )

  const begin = useCallback(async () => {
    setPhase('starting')
    try {
      recorderRef.current = await startRecording(setLevel)
      setPhase('recording')
    } catch (err) {
      // A denied permission is the common case and deserves plain words, not a
      // DOMException name.
      const name = err instanceof Error ? err.name : ''
      fail(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access was blocked. Allow it for this site and try again.'
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : `Could not start recording: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }, [fail])

  const finish = useCallback(async () => {
    const rec = recorderRef.current
    if (!rec) return
    recorderRef.current = null
    setPhase('transcribing')
    setLevel(0)

    let blob: Blob | null
    try {
      blob = await rec.stop()
    } catch (err) {
      fail(`Could not finish the recording: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    if (!blob) {
      fail('Nothing was picked up — check the microphone is not muted.')
      return
    }

    try {
      const form = new FormData()
      form.append('audio', blob, 'question.wav')
      const res = await fetch('/api/ai/voice', { method: 'POST', body: form })
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string }

      if (!res.ok || !data.text) {
        fail(data.error ?? `Transcription failed (${res.status}).`)
        return
      }

      setPhase('idle')
      onTranscript(data.text)
    } catch (err) {
      fail(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [fail, onTranscript])

  if (!supported) return null

  const busy = phase === 'starting' || phase === 'transcribing'
  const recording = phase === 'recording'

  const label = recording
    ? 'Stop recording and transcribe'
    : phase === 'transcribing'
      ? 'Transcribing'
      : phase === 'starting'
        ? 'Starting the microphone'
        : 'Ask by voice'

  return (
    <button
      type="button"
      onClick={recording ? finish : begin}
      disabled={disabled || busy}
      aria-label={label}
      title={label}
      className={[
        // 44px on touch, compact on desktop — this app's tap-target minimum.
        'relative shrink-0 size-11 sm:size-8 rounded-lg flex items-center justify-center transition-colors',
        'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        recording
          ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
          : 'border bg-muted/30 text-muted-foreground hover:bg-muted',
        className ?? '',
      ].join(' ')}
    >
      {busy ? (
        <Loader2 size={16} className="sm:size-3.5 animate-spin" />
      ) : recording ? (
        <Square size={14} className="sm:size-3" />
      ) : (
        <Mic size={16} className="sm:size-3.5" />
      )}

      {/**
       * A live level ring. A voice button with no feedback is indistinguishable
       * from a broken one, and the single most common real failure is a muted
       * microphone — which looks exactly like silence until the upload is
       * rejected. Scale only, so it costs no layout.
       */}
      {recording && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-destructive/60"
          style={{ transform: `scale(${1 + Math.min(level, 1) * 0.35})`, opacity: 0.25 + Math.min(level, 1) * 0.5 }}
        />
      )}
    </button>
  )
}
