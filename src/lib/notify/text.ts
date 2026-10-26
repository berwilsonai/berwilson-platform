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
  /**
   * The carrier's email-to-SMS domain for this handle, when one is known.
   *
   * Set it and the message goes out as mail to `<digits>@<domain>`, which the
   * carrier delivers as a text. See {@link gatewayAddress} for why that is now
   * the preferred transport rather than a fallback.
   */
  carrierDomain?: string | null
}

/**
 * Default carrier domain for every target that does not name its own.
 *
 * Both executives are on T-Mobile (`tmomail.net`), so one variable covers the
 * roster; a fourth field on a `PEPPER_TEXT_TARGETS` entry overrides it for one
 * person when somebody changes carrier.
 */
const DEFAULT_CARRIER_DOMAIN = process.env.PEPPER_TEXT_GATEWAY_DOMAIN ?? null

/**
 * The carrier gateway address for a target, or null when none is configured.
 *
 * ⚠ THIS IS THE TRANSPORT THAT WORKS, AND THE SHORTCUT IS THE ONE THAT DID NOT.
 * Measured 2026-10-19: every Pepper text since the channel shipped on 10-12 had
 * failed — ten consecutive runs of `Couldn't find shortcut "Pepper Text
 * Richard"` — because the two shortcuts must be built BY HAND in Shortcuts.app
 * (macOS 27 removed Messages' AppleScript dictionary) and never had been. A
 * channel whose setup cannot be automated is a channel that is off.
 *
 * Three things the gateway fixes at once:
 *
 *   1. **No hand-built step, and nothing to lose.** It is a Gmail send, which
 *      this platform already does every morning.
 *   2. **IT KILLS THE SELF-LOOP AT THE SOURCE.** The Shortcut sends as
 *      Richard's own Apple ID, so a text to Eric lands in the Richard↔Eric
 *      conversation the iMessage sweep ingests — the 2026-10-09 failure that
 *      made 131 of 481 open commitments Pepper reading her own notes. A gateway
 *      message arrives from a carrier shortcode, in a conversation that is not
 *      one of ours at all. The hash guard below is still written, because
 *      belt-and-braces costs one insert.
 *   3. **One sender for both people.** Each executive gets a single Pepper
 *      thread on their phone, separate from their human texts.
 *
 * ⚠ AND WHAT IT COSTS, SAID PLAINLY. The body travels Gmail → the carrier,
 * where the on-box transport did not. That is the same path Pepper's morning
 * EMAIL note already takes daily with the same content, so it adds no exposure
 * the 2026-07-07 cutover had closed — but it is a real difference from the
 * docblock at the top of this file, which was written when the Shortcut was the
 * only plan. A confidential project must never reach this channel either way;
 * that is enforced where the message is composed, not here.
 */
export function gatewayAddress(
  target: TextTarget,
  // ⚠ INJECTABLE, so a test is not reading an env var captured at module load —
  // §12: a test that hardcodes (or reaches around) the value it verifies is
  // testing the copy. Production passes nothing and gets the configured domain.
  opts: { defaultDomain?: string | null } = {}
): string | null {
  const fallback = opts.defaultDomain === undefined ? DEFAULT_CARRIER_DOMAIN : opts.defaultDomain
  const domain = (target.carrierDomain ?? fallback ?? '').trim().replace(/^@/, '')
  if (!domain || !domain.includes('.')) return null
  const digits = target.handle.replace(/\D/g, '')
  // US gateways are addressed by the 10-digit number, without the country code.
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (local.length < 10) return null
  return `${local}@${domain}`
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
    if (parts.length < 3 || parts.length > 4 || parts.some((p) => !p)) {
      problems.push(`malformed target (want email=handle=shortcut[=carrier.domain]): ${entry}`)
      continue
    }
    const [email, handleRaw, shortcut, carrierDomain] = parts
    const handle = normalizeHandle(handleRaw)
    if (!handle) {
      problems.push(`unusable handle for ${email}: ${handleRaw}`)
      continue
    }
    if (!email.includes('@')) {
      problems.push(`not an email address: ${email}`)
      continue
    }
    targets.push({
      email: email.toLowerCase(),
      handle,
      shortcut,
      carrierDomain: carrierDomain ?? null,
    })
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
  /** Which transport carried it. A log that cannot say this cannot be believed. */
  via?: 'gateway' | 'shortcut'
}

/**
 * WHO A TEXT TO ERIC OR RICHARD COMES FROM, AND WHAT IT IS SIGNED AS.
 *
 * Richard's instruction, 2026-10-26: *"when notifications are texted to Eric
 * or myself, make sure they come from info@berwilson.com signed as Pepper."*
 * Three separate things carry that, because a carrier delivers them
 * independently and any one of them can be the only one that survives:
 *
 *   1. **The envelope** — `info@`, Pepper's own seat. Measured against the live
 *      Sent mail on 10-26: all 11 gateway sends in 30 days already read
 *      `Pepper <info@berwilson.com>`, so this half was right and is now PINNED
 *      BY A TEST rather than left to an unset env var to decide.
 *   2. **The subject**, which a carrier renders into the delivered message —
 *      so it names her rather than the platform. It read `Ber AI` until 10-26,
 *      which is the system's name, not the sender's.
 *   3. **The body's signature**, which is the ONLY one of the three a carrier
 *      cannot strip. {@link signAsPepper}.
 *
 * ⚠ THE ENV VARS STAY AS OVERRIDES BUT THE DEFAULTS ARE THE REQUIREMENT. An
 * unset variable deciding the sender is how an identity drifts without anybody
 * editing it, so `gatewaySender()` is the one place that answers the question
 * and `text.test.ts` asserts what it answers.
 */
const GATEWAY_FROM = process.env.PEPPER_TEXT_FROM ?? 'info@berwilson.com'
const GATEWAY_FROM_NAME = process.env.PEPPER_TEXT_FROM_NAME ?? 'Pepper'

/**
 * The subject on a gateway message.
 *
 * Carriers render the subject as the first line of the text, so it is one short
 * label and never a summary — the body already says what happened. It is her
 * name because the first thing a text should answer is who is speaking.
 */
const GATEWAY_SUBJECT = process.env.PEPPER_TEXT_SUBJECT ?? 'Pepper'

/** The sender identity on every text, in one place so a test can pin it. */
export function gatewaySender(): { from: string; fromName: string; subject: string } {
  return { from: GATEWAY_FROM, fromName: GATEWAY_FROM_NAME, subject: GATEWAY_SUBJECT }
}

/** How Pepper signs a text. One home — `record-alert.ts` had the only copy. */
export const PEPPER_SIGNATURE = '— Pepper'

/**
 * Sign a text as Pepper, once.
 *
 * ⚠ AT THE CHOKE POINT, NOT IN EACH COMPOSER (§12: a convention every caller
 * has to remember is one that goes missing in the route added next year). Of
 * the four live text passes, exactly ONE — `record_alert` — signed its own
 * body; the task reminder, the `document_ready` text and the `agent_answer`
 * text all went out unsigned, which is what Richard was reading when he asked
 * for this. Signing here covers those three and every pass added later.
 *
 * ⚠ IDEMPOTENT ON PURPOSE, AND THAT IS WHAT PRESERVES `record_alert`'S SHAPE.
 * It puts its signature ABOVE the record's link deliberately — "where a single
 * tap lands" — so a blind append would both double the signature and move it.
 * A body that already carries the line is returned untouched.
 */
export function signAsPepper(body: string): string {
  const clean = normalizeBody(body)
  if (!clean) return clean
  // Matched as a WHOLE LINE, never by containment (§12): a text whose prose
  // happens to mention Pepper is not a signed text, and
  // `"— Pepper"` appearing mid-sentence must not suppress the signature.
  const signed = clean.split('\n').some((line) => line.trim() === PEPPER_SIGNATURE)
  return signed ? clean : `${clean}\n\n${PEPPER_SIGNATURE}`
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
  // ⚠ SIGN BEFORE HASHING, AND THE ORDER IS LOAD-BEARING. The self-loop guard
  // works by hashing what we send and having ingestion drop what it finds in
  // `pepper_outbound_texts`; signing AFTER the hash would put a body on the wire
  // that hashes to something the ledger does not hold, which is the 2026-10-09
  // failure (131 of 481 commitments were Pepper reading her own notes) rebuilt
  // by a signature. One value is hashed, recorded and sent.
  const clean = signAsPepper(body)
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

  // ⚠ GATEWAY FIRST, SHORTCUT SECOND — and the order is the whole fix, not a
  // preference. See `gatewayAddress`: the shortcut transport had delivered
  // nothing in the seven days it had been live, because its one manual setup
  // step was never done. The shortcut is kept as the fallback for a box with no
  // carrier domain configured, which is also the only configuration the
  // existing tests describe.
  const gateway = gatewayAddress(target)
  if (gateway) {
    try {
      const { sendMail } = await import('@/lib/integrations/google-workspace')
      await sendMail({
        to: gateway,
        subject: GATEWAY_SUBJECT,
        // A carrier strips markup; `<br>` is the one thing that survives as a
        // line break across both the SMS and MMS renderings.
        html: escapeHtml(clean).replace(/\n/g, '<br>'),
        from: GATEWAY_FROM,
        fromName: GATEWAY_FROM_NAME,
      })
      return { ok: true, handle: target.handle, via: 'gateway' }
    } catch (err) {
      // Fall through to the shortcut rather than giving up: a Gmail hiccup
      // should not cost the message when a second transport exists.
      const reason = err instanceof Error ? err.message : String(err)
      try {
        await runShortcut(target.shortcut, clean)
        return { ok: true, handle: target.handle, via: 'shortcut' }
      } catch (err2) {
        return {
          ok: false,
          handle: target.handle,
          error:
            `gateway (${gateway}) failed: ${reason}; and the shortcut fallback failed: ` +
            `${err2 instanceof Error ? err2.message : String(err2)}`,
        }
      }
    }
  }

  try {
    await runShortcut(target.shortcut, clean)
    return { ok: true, handle: target.handle, via: 'shortcut' }
  } catch (err) {
    return {
      ok: false,
      handle: target.handle,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Minimal escaping — the body is plain text going into an HTML mail part. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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
