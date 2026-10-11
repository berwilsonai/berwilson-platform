/**
 * Capture microphone audio as 16 kHz mono WAV, in the browser.
 *
 * ⚠ WHY NOT `MediaRecorder`. Measured 2026-10-11 against the actual decoder on
 * this box: `afconvert -hf` reads Opus inside an **Ogg** container (`.opus`,
 * `.ogg`, `.oga`) and has no WebM demuxer at all. Chrome's `MediaRecorder`
 * default is `audio/webm;codecs=opus` — the one combination that cannot be
 * decoded here — and there is deliberately no ffmpeg on this machine
 * (`src/lib/ai/whisper.ts` spawns `afconvert` precisely to avoid it). So the
 * obvious implementation produces a file the transcriber cannot open, on the
 * most likely browser, with the failure arriving only at upload time.
 *
 * Encoding WAV here removes the negotiation entirely: one format, no codec
 * support to detect, and it works on iOS Safari, which is the point of a voice
 * button. 16 kHz mono is also exactly what `whisper.ts` converts to anyway, so
 * nothing downstream changes and `afconvert` is a cheap pass-through.
 *
 * `ScriptProcessorNode` is deprecated but is the one capture path available
 * everywhere including iOS Safari without serving a separate AudioWorklet
 * module. For a few seconds of speech on the main thread that is the right
 * trade; if it ever glitches, an AudioWorklet is a drop-in replacement for
 * `start()` alone.
 */

/** What whisper.cpp wants, so no resampling happens twice. */
export const TARGET_SAMPLE_RATE = 16000

/** Guard against a stuck recorder filling memory — 3 minutes of 16 kHz mono. */
const MAX_SAMPLES = TARGET_SAMPLE_RATE * 180

/**
 * Average-decimate to the target rate.
 *
 * Averaging rather than picking every Nth sample: dropping samples aliases
 * high-frequency noise down into the speech band, which is audible to whisper
 * as hiss and costs accuracy on consonants.
 */
function downsample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_SAMPLE_RATE) return input
  if (fromRate < TARGET_SAMPLE_RATE) return input // never upsample; whisper handles it

  const ratio = fromRate / TARGET_SAMPLE_RATE
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), input.length)
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = end > start ? sum / (end - start) : 0
  }
  return out
}

/** Wrap mono float samples in a 16-bit PCM WAV container. */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // format: PCM
  view.setUint16(22, 1, true) // channels: mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling, or a sample just past ±1 wraps to the opposite
    // extreme and becomes a click.
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export interface Recorder {
  /** Resolves to the recorded WAV, or null if nothing audible was captured. */
  stop: () => Promise<Blob | null>
  /** Abandon the recording and release the microphone. */
  cancel: () => void
}

/**
 * Start recording. Resolves once the microphone is live, so a caller can show
 * "listening" only when it is true.
 *
 * `onLevel` receives a 0-1 loudness figure per block for a level meter — a
 * voice button with no feedback is indistinguishable from a broken one.
 */
export async function startRecording(onLevel?: (level: number) => void): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  type WindowWithLegacyAudio = Window & { webkitAudioContext?: typeof AudioContext }
  const Ctor = window.AudioContext ?? (window as WindowWithLegacyAudio).webkitAudioContext
  if (!Ctor) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('This browser cannot record audio.')
  }
  const ctx = new Ctor()

  // iOS starts contexts suspended until a gesture-initiated resume.
  if (ctx.state === 'suspended') await ctx.resume()

  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const blocks: Float32Array[] = []
  let total = 0
  let stopped = false

  processor.onaudioprocess = (e) => {
    if (stopped) return
    const input = e.inputBuffer.getChannelData(0)
    if (total < MAX_SAMPLES) {
      blocks.push(new Float32Array(input))
      total += input.length
    }
    if (onLevel) {
      let peak = 0
      for (let i = 0; i < input.length; i++) {
        const a = Math.abs(input[i])
        if (a > peak) peak = a
      }
      onLevel(peak)
    }
  }

  source.connect(processor)
  // A ScriptProcessorNode only runs while connected to the graph. Routing it to
  // a zero-gain node keeps it pulling without playing the microphone back into
  // the room, which would feed an echo into the recording.
  const mute = ctx.createGain()
  mute.gain.value = 0
  processor.connect(mute)
  mute.connect(ctx.destination)

  const release = () => {
    stopped = true
    processor.onaudioprocess = null
    try {
      processor.disconnect()
      mute.disconnect()
      source.disconnect()
    } catch {
      // already torn down
    }
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }

  return {
    stop: async () => {
      release()
      if (total === 0) return null

      const merged = new Float32Array(total)
      let offset = 0
      for (const b of blocks) {
        merged.set(b, offset)
        offset += b.length
      }

      // Silence check before the upload: a muted microphone or a denied-then-
      // granted permission produces a file of zeroes, and whisper answers with
      // confident hallucinated text on pure silence rather than an error.
      let peak = 0
      for (let i = 0; i < merged.length; i++) {
        const a = Math.abs(merged[i])
        if (a > peak) peak = a
      }
      if (peak < 0.005) return null

      return encodeWav(downsample(merged, ctx.sampleRate))
    },
    cancel: release,
  }
}
