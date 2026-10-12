/**
 * Outbound text messages, sent from the Studio itself.
 *
 * ⚠ APPLESCRIPT IS GONE. Measured on this box 2026-10-12, macOS 27.0 (26A428):
 * `sdef /System/Applications/Messages.app` returns NOTHING — Messages ships no
 * scripting dictionary at all, so there is no `send`, no `buddy` and no
 * `service` command. Every published "send an iMessage from the terminal"
 * recipe is written against a dictionary this OS does not have, and the failure
 * is not a clean error: Messages accepts the Apple event and never answers, so
 * a naive implementation hangs until the AppleEvent timeout (-1712, reproduced
 * twice here) rather than failing. On an unattended 06:50 cron that is a
 * fifteen-minute hang and a silently missing morning.
 *
 * So the transport is the Shortcuts CLI, which is Apple's sanctioned
 * replacement and present at /usr/bin/shortcuts. It needs ONE two-action
 * shortcut per recipient, built by hand once — see deploy/pepper-text-setup.md.
 * That hand-built step is unavoidable and is the honest cost of keeping this
 * channel on-box: the alternative is an SMS vendor, which would mean every
 * morning's obligations leaving the hardware, against the whole point of the
 * 2026-07-07 cutover.
 *
 * ⚠ AND THE SELF-LOOP. The Studio sends as Richard's own Apple ID, so a text to
 * Eric lands in the Richard↔Eric conversation that the iMessage sweep ingests
 * and extracts commitments from. This is the 2026-10-09 bug exactly — 131 of
 * 481 open commitments were Pepper reading her own morning notes — in a channel
 * with no Gmail labels to spot it with, and `is_from_me` cannot discriminate
 * because Richard's own real texts are also from him and those are precisely
 * what the sweep is for. Every send is therefore HASHED INTO
 * `pepper_outbound_texts` BEFORE it goes, and ingestion drops what it finds
 * there. Structural, not a prefix or a display name anybody can reword (§12).
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { provDbAs, PEPPER_ACTOR, type OutboundTextRow } from '@/lib/provenance/db'

const SHORTCUTS_BIN = process.env.SHORTCUTS_BIN ?? '/usr/bin/shortcuts'

/**
 * How long a send may take before it is killed.
 *
 * Generous because the first run of a shortcut can launch Messages, and mean
 * because a hung send must not hold the 06:50 cron: LM Studio serves one
 * request at a time and the note's model call is already in that window.
 */
const SEND_TIMEOUT_MS = Number(process.env.PEPPER_TEXT_TIMEOUT_MS ?? 60_000)

export type TextKind = OutboundTextRow['kind']

export interface TextTarget {
  /** The team member this is for, which is how callers address a person. */
  email: string
  /** E.164 handle, for the self-loop guard and the audit row. */
  handle: string
  /** The Shortcuts shortcut that sends to that handle. */
  shortcut: string
}

/**
 * Who can be texted, from one env var.
 *
 * `PEPPER_TEXT_TARGETS=moose@berwilson.com=+18018159150=Pepper Text Richard;…`
 *
 * ⚠ ONE VARIABLE RATHER THAN THREE PER PERSON, and parsed with a tested parser
 * rather than a split chain, because this is the list that decides who a
 * message about a deal is sent to. A malformed entry must drop THAT entry and
 * say so — never widen to "send to everyone" and never throw at 06:50.
 */
export function parseTextTargets(raw: string | undefined): {
  targets: TextTarget[]
  problems: string[]
} {
  const targets: TextTarget[] = []
  const problems: string[] = []
  if (!raw || !raw.trim()) return { targets, problems }

  for (const chunk of raw.split(';')) {
    const entry = chunk.trim()
    if (!entry) continue
    const parts = entry.split('=').map((p) => p.trim())
    if (parts.length !== 3 || parts.some((p) => !p)) {
      problems.push(`malformed target (want email=handle=shortcut): ${entry}`)
      continue
    }
    const [email, handleRaw, shortcut] = parts
    const handle = normalizeHandle(handleRaw)
    if (!handle) {
      problems.push(`unusable handle for ${email}: ${handleRaw}`)
      continue
    }
    if (!email.includes('@')) {
      problems.push(`not an email address: ${email}`)
      continue
    }
    targets.push({ email: email.toLowerCase(), handle, shortcut })
  }
  return { targets, problems }
}

export function textTargets(): { targets: TextTarget[]; problems: string[] } {
  return parseTextTargets(process.env.PEPPER_TEXT_TARGETS)
}

/**
 * A phone number as E.164, or null if it cannot be one.
 *
 * Deliberately conservative: a 10-digit US number gets +1, an 11-digit number
 * starting 1 gets +, anything already starting + is trusted, and everything
 * else is REFUSED rather than guessed. A wrong handle here texts a deal's
 * obligations to a stranger, which is the one outcome worth failing closed for.
 */
export function normalizeHandle(raw: string): string | null {
  const trimmed = raw.trim()
  if (/^\+\d{8,15}$/.test(trimmed)) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** The hash ingestion matches on. Normalized so whitespace cannot defeat it. */
export function bodyHash(body: string): string {
  return createHash('sha256').update(normalizeBody(body)).digest('hex')
}

/**
 * ⚠ THE NORMALIZATION IS PART OF THE GUARD, NOT TIDINESS. A message read back
 * out of chat.db is not byte-identical to what was sent — line endings differ
 * and trailing whitespace is trimmed somewhere in the pipeline. Hashing the raw
 * string would make the guard miss, and a guard that misses is the self-loop.
 */
export function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()
}

export interface SendTextResult {
  ok: boolean
  handle: string
  error?: string
  /** True when the body was recorded but the transport was not attempted. */
  dryRun?: boolean
}

/**
 * Send one text.
 *
 * The order is load-bearing: RECORD, then send. A spurious guard row for a send
 * that failed is harmless — it means one message we never sent would be ignored
 * if it somehow arrived. Recording AFTER the send leaves a window in which the
 * sweep could ingest our own message as news, which is the failure that cost
 * 131 commitments.
 */
export async function sendText(args: {
  target: TextTarget
  body: string
  kind: TextKind
  dryRun?: boolean
}): Promise<SendTextResult> {
  const { target, body, kind, dryRun = false } = args
  const clean = normalizeBody(body)
  if (!clean) return { ok: false, handle: target.handle, error: 'empty body' }

  const { error: recErr } = await provDbAs(PEPPER_ACTOR)
    .from('pepper_outbound_texts')
    .insert({
      handle: target.handle,
      body_sha256: bodyHash(clean),
      body: clean,
      kind,
    })
  if (recErr) {
    // ⚠ REFUSE TO SEND. Without the guard row the sweep will read this message
    // back as a counterparty obligation. An unsent morning text is a visible
    // problem; a self-feeding ledger is an invisible one.
    return {
      ok: false,
      handle: target.handle,
      error: `not sent — could not record the self-loop guard: ${recErr.message}`,
    }
  }

  if (dryRun) return { ok: true, handle: target.handle, dryRun: true }

  try {
    await runShortcut(target.shortcut, clean)
    return { ok: true, handle: target.handle }
  } catch (err) {
    return {
      ok: false,
      handle: target.handle,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Hand the body to a shortcut on stdin-as-a-file.
 *
 * `shortcuts run` takes `--input-path`, not stdin, so the body goes to a temp
 * file in the session scratch and is removed afterwards. It is written 0600:
 * the morning text names counterparties and figures, and /tmp is world-readable.
 */
async function runShortcut(shortcut: string, body: string): Promise<void> {
  const path = join(tmpdir(), `pepper-text-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  await fs.writeFile(path, body, { mode: 0o600 })
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(SHORTCUTS_BIN, ['run', shortcut, '--input-path', path], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(
          new Error(
            `shortcut "${shortcut}" did not finish in ${Math.round(SEND_TIMEOUT_MS / 1000)}s ` +
              `(killed). Messages may be showing a confirmation dialog — a shortcut used ` +
              `unattended must be allowed to run without asking.`
          )
        )
      }, SEND_TIMEOUT_MS)
      child.stderr.on('data', (d) => {
        stderr += String(d)
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`cannot run ${SHORTCUTS_BIN}: ${err.message}`))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) return resolve()
        reject(
          new Error(
            `shortcut "${shortcut}" exited ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}. ` +
              `Check it exists: \`shortcuts list\`.`
          )
        )
      })
    })
  } finally {
    await fs.rm(path, { force: true })
  }
}
