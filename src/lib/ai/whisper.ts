// Local speech-to-text via whisper.cpp (Metal) on the Studio. Fully offline —
// nothing leaves the hardware, same posture as the local LLM. The macOS
// built-in `afconvert` decodes any input (m4a/aac/etc.) to 16 kHz mono WAV,
// which whisper.cpp reads natively (no ffmpeg needed). Configured via env:
//   WHISPER_BIN   → path to the whisper-cli binary
//   WHISPER_MODEL → path to the ggml model (default: large-v3-turbo)
// Both are set on the Studio by deploy/deploy-to-studio.sh; unset elsewhere
// (local dev / non-Studio), where whisperEnabled() is false.

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'

const WHISPER_BIN = process.env.WHISPER_BIN
const WHISPER_MODEL = process.env.WHISPER_MODEL
const AFCONVERT = process.env.AFCONVERT_BIN ?? '/usr/bin/afconvert'
// Ceiling for one transcription — a very long recording on Metal still finishes
// well inside this; it only guards against a wedged process.
const TRANSCRIBE_TIMEOUT_MS = 120 * 60 * 1000
const DECODE_TIMEOUT_MS = 10 * 60 * 1000

export function whisperEnabled(): boolean {
  return Boolean(WHISPER_BIN && WHISPER_MODEL)
}

/** The configured paths, for diagnostics. */
export function whisperPaths(): { bin?: string; model?: string } {
  return { bin: WHISPER_BIN, model: WHISPER_MODEL }
}

/**
 * Are the binary AND the model actually present on this host?
 *
 * `whisperEnabled()` only says the env vars are set. Both targets are build
 * artifacts living OUTSIDE the repo (the model is a ~1.5GB download), so either
 * can vanish — a wiped home dir, a cleanup pass, a fresh machine — while the
 * config still looks perfect. That happened: the model disappeared and the only
 * symptom was whisper-cli's opaque "failed to initialize whisper context" at
 * the moment someone uploaded a recording. Check the files, not just the env.
 */
export async function whisperAvailable(): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = []
  for (const [label, path] of [['binary', WHISPER_BIN], ['model', WHISPER_MODEL]] as const) {
    if (!path) {
      missing.push(`${label} (path not configured)`)
      continue
    }
    try {
      await fs.access(path)
    } catch {
      missing.push(`${label} (${path})`)
    }
  }
  return { ok: missing.length === 0, missing }
}

interface RunResult {
  code: number | null
  stderr: string
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 60000)} min`))
    }, timeoutMs)
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 20_000) stderr += d.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stderr })
    })
  })
}

/**
 * Transcribe an audio buffer to text. Decodes to 16 kHz mono WAV with afconvert,
 * then runs whisper.cpp (beam search 5 for accuracy). Throws on failure. Cleans
 * up all temp files. Language is auto-detected.
 */
export async function transcribeAudio(buffer: Buffer, fileName: string): Promise<string> {
  if (!whisperEnabled()) {
    throw new Error('Whisper transcription is not configured on this host (WHISPER_BIN/WHISPER_MODEL unset).')
  }
  const present = await whisperAvailable()
  if (!present.ok) {
    throw new Error(
      `Whisper is configured but missing on disk: ${present.missing.join(', ')}. ` +
        'Re-download the model with `cd ~/whisper.cpp/models && ./download-ggml-model.sh large-v3-turbo`, ' +
        'or rebuild the binary per deploy/README.md.',
    )
  }
  const dir = await fs.mkdtemp(join(tmpdir(), 'bw-whisper-'))
  const ext = extname(fileName) || '.m4a'
  const inPath = join(dir, `audio${ext}`)
  const wavPath = join(dir, 'audio.wav')
  const outBase = join(dir, 'out')
  try {
    await fs.writeFile(inPath, buffer)

    const conv = await run(
      AFCONVERT,
      [inPath, wavPath, '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1'],
      DECODE_TIMEOUT_MS,
    )
    if (conv.code !== 0) throw new Error(`Audio decode (afconvert) failed: ${conv.stderr.slice(0, 400)}`)

    const tr = await run(
      WHISPER_BIN as string,
      ['-m', WHISPER_MODEL as string, '-f', wavPath, '-otxt', '-of', outBase, '-np', '-nt', '-bs', '5'],
      TRANSCRIBE_TIMEOUT_MS,
    )
    if (tr.code !== 0) throw new Error(`Transcription (whisper) failed: ${tr.stderr.slice(0, 400)}`)

    return (await fs.readFile(`${outBase}.txt`, 'utf-8')).trim()
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
