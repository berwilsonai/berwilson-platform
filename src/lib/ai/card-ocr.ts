/**
 * Local text recognition for the business-card scanner.
 *
 * Spawns `bw-ocr` (scripts/ocr/card-ocr.swift), a tiny binary around Apple's
 * Vision framework. Fully offline — no model, no RAM held resident, nothing
 * leaves the hardware. Same posture and the same spawn-a-binary pattern as
 * whisper.ts, and deliberately NOT a vision LLM: there is no VL model loaded in
 * LM Studio (that was Richard's call — one is 36GB of contention), and shipping
 * a photo of someone's card to a cloud model would be the one place this
 * feature leaked real data.
 *
 * Configured via CARD_OCR_BIN; defaults to ~/.local/bin/bw-ocr, where
 * scripts/build-ocr.sh installs it.
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, extname } from 'node:path'

const OCR_BIN = process.env.CARD_OCR_BIN ?? join(homedir(), '.local', 'bin', 'bw-ocr')

/** A single card is one small image; this only guards against a wedged process. */
const OCR_TIMEOUT_MS = 60_000

/** What Vision can decode. Phone cameras produce heic/jpeg. */
export const CARD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/tiff']

export async function ocrAvailable(): Promise<boolean> {
  try {
    await fs.access(OCR_BIN)
    return true
  } catch {
    return false
  }
}

export function ocrBinPath(): string {
  return OCR_BIN
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`OCR timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < 200_000) stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 20_000) stderr += d.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/**
 * Read the text off a card image. The image is written to a temp file only for
 * as long as the recognizer needs it and is deleted in `finally` — it is never
 * written to Supabase storage and never persisted anywhere. Throws with an
 * actionable message when the binary is missing or nothing legible was found.
 */
export async function ocrImage(buffer: Buffer, fileName: string): Promise<string> {
  if (!(await ocrAvailable())) {
    throw new Error(
      `Card scanning is not set up on this host: no OCR binary at ${OCR_BIN}. ` +
        'Build it with `zsh scripts/build-ocr.sh` (needs the macOS Command Line Tools).',
    )
  }

  const dir = await fs.mkdtemp(join(tmpdir(), 'bw-card-'))
  const path = join(dir, `card${extname(fileName) || '.jpg'}`)

  try {
    await fs.writeFile(path, buffer)
    const { code, stdout, stderr } = await run(OCR_BIN, [path], OCR_TIMEOUT_MS)
    if (code !== 0) {
      throw new Error(`Could not read the image — ${stderr.trim() || `OCR exited ${code}`}`)
    }

    const text = stdout.trim()
    if (text.length < 5) {
      throw new Error(
        'No text found in the photo. Try again with the card filling the frame, in even light.',
      )
    }
    return text
  } finally {
    // The photo exists on disk only for the length of the recognizer run.
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
