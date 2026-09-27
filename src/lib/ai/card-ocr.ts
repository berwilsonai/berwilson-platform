/**
 * Local text recognition — business cards, scanned documents and images.
 *
 * Spawns `bw-ocr` (scripts/ocr/card-ocr.swift), a tiny binary around Apple's
 * Vision framework. Fully offline — no model, no RAM held resident, nothing
 * leaves the hardware. Same posture and the same spawn-a-binary pattern as
 * whisper.ts, and deliberately NOT a vision LLM: there is no VL model loaded in
 * LM Studio (that was Richard's call — one is 36GB of contention), and shipping
 * a photo of someone's card to a cloud model would be the one place this
 * feature leaked real data.
 *
 * **Measured 2026-09-26, which is why documents came here rather than to a VL
 * model:** the 11-page scanned Alaska upland mining lease recognized in **3
 * seconds** at 200 DPI, 26,103 characters, including the line the agent had
 * been asked for three times — *"containing approximately 665 acres, more or
 * less"*. A 7B vision model would have taken minutes per page, held ~6GB
 * resident against a 22GB text model on a 36GB box, and transcribed dense
 * printed text less faithfully.
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

/** What Vision can read as a scanned document, on top of the image types above. */
export const OCR_DOCUMENT_TYPES = ['application/pdf']

/**
 * A multi-page scan is not a business card. The lease above took 3s for 11
 * pages, but a 300-page title exhibit at 200 DPI is minutes of rendering, and
 * the binary is spawned from a request handler or a cron.
 */
const DOC_OCR_TIMEOUT_MS = Number(process.env.OCR_DOCUMENT_TIMEOUT_MS) || 900_000

/** Render resolution. 72 DPI reads body text but is marginal on small print; 200 is reliable. */
const DOC_OCR_DPI = Number(process.env.OCR_DPI) || 200

/** Page ceiling per document, so one enormous exhibit cannot run unbounded. */
const DOC_OCR_MAX_PAGES = Number(process.env.OCR_MAX_PAGES) || 300

/**
 * Raised when the recognizer failed for a reason that may not recur — it was
 * killed, it timed out, the render ran out of memory.
 *
 * The distinction from "read it, found nothing" is the whole point and it was
 * learned the hard way on 2026-09-26: with the Studio 20GB into swap, rendering
 * an 18.5MB scan at 200 DPI failed intermittently, and because both outcomes
 * came back as null the pipeline settled those documents as `skipped` — the same
 * state it uses for a file it can never read. `R0170 (1).pdf` was marked
 * permanently unreadable while OCR'ing perfectly by hand a minute later
 * (105,063 characters). A transient failure recorded as a permanent one is the
 * silent-failure pattern this whole session was about.
 */
export class OcrFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OcrFailedError'
  }
}

/**
 * OCR a scanned document (PDF or image) that carries no extractable text layer.
 *
 * Returns null ONLY when the recognizer read the file and found nothing legible
 * — a blank or purely graphical scan, which is a fact to record rather than an
 * error to retry forever. Anything else throws, so a caller can leave the
 * document retryable instead of writing it off.
 */
export async function ocrDocument(
  buffer: ArrayBuffer | Buffer,
  fileName: string
): Promise<string | null> {
  if (!(await ocrAvailable())) {
    throw new Error(
      `OCR is not set up on this host: no binary at ${OCR_BIN}. ` +
        'Build it with `zsh scripts/build-ocr.sh` (needs the macOS Command Line Tools).',
    )
  }

  const dir = await fs.mkdtemp(join(tmpdir(), 'bw-ocr-doc-'))
  const path = join(dir, `scan${extname(fileName) || '.pdf'}`)

  try {
    await fs.writeFile(path, Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer))
    const { code, stdout, stderr } = await run(
      OCR_BIN,
      [path, '--dpi', String(DOC_OCR_DPI), '--max-pages', String(DOC_OCR_MAX_PAGES)],
      DOC_OCR_TIMEOUT_MS,
    )

    // 5 is the binary's "read it, found no text" code — a blank or purely
    // graphical scan, and the only outcome that is a property of the document.
    if (code === 5) {
      console.log(`[ocr] ${fileName}: no text recognized (blank or graphical scan)`)
      return null
    }
    // 3 means the file itself could not be decoded — also permanent.
    if (code === 3) {
      console.log(`[ocr] ${fileName}: could not decode — ${stderr.trim()}`)
      return null
    }
    if (code !== 0) {
      throw new OcrFailedError(
        `OCR of ${fileName} exited ${code}${stderr.trim() ? ` — ${stderr.trim()}` : ''}` +
          ' (killed, out of memory, or timed out — retryable)',
      )
    }

    const text = stdout.trim()
    return text.length >= 40 ? text : null
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
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
