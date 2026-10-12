/**
 * The text-message sweep: snapshot → classify → write `email_threads` rows.
 *
 * ⚠ IT WRITES ROWS AND STOPS, AND THAT IS THE WHOLE DESIGN. The eight phases
 * the hourly mail sweep already runs — summarize, cluster, stage, route, apply,
 * embed, commitments, predecide — all read `email_threads` and none of them is
 * Gmail-specific. So this pass does not summarize, match, or create anything;
 * it translates (see to-thread.ts) and hands over. A second pipeline for texts
 * would be a second place for every one of those decisions to drift.
 *
 * ⚠ IT READS A SNAPSHOT, NOT THE LIVE DATABASE. `~/Library/Messages` is
 * TCC-protected and Full Disk Access is not granular, so the platform's own
 * process — which holds the service-role key and the mail tokens — must never
 * have it. `bw-snapshot` holds FDA, can only copy, and leaves the three files
 * in ~/berwilson-data/local-sources/.
 *
 * §11 is intact: nothing here creates a project, opportunity, party or task.
 * The staged session still waits for a human on /decide.
 */

import { storeFetchedThreads } from '@/lib/email-sweep/fetch-phase'
import { messagesReadable, readChats, snapshotDbPath } from './read'
import { buildTargets, scoreChats } from './targets'
import { chatToThreads } from './to-thread'
import { redactPrivateTexts } from './redact'

/**
 * How far back sessions are written. Older ones are not revisited.
 */
const DEFAULT_INGEST_DAYS = 30

/**
 * How far back the token calibration reads — deliberately far more.
 *
 * ⚠ CALIBRATE OVER MORE CORPUS THAN YOU INGEST, OR THE FILTER GETS LOOSER THE
 * LESS IT LOOKS AT. Rarity is what lets one word name a record (see
 * targets.ts), and the cutoff is a SHARE of the conversations read: at 530
 * chats a word must appear in at most 3 to count as distinctive, at 170 chats
 * at most 1. So a word that is perfectly ordinary in Richard's life but happens
 * to land in a single conversation inside a thirty-day window is judged
 * identifying — and the shorter the window, the more such words there are.
 *
 * Measured 2026-10-11: over 180 days `stockton`, `strategic` and `bloom` are
 * ordinary (4, 5 and 5 chats); over 30 days all three read as distinctive. The
 * ingest window is a question about scope, the calibration window is a question
 * about evidence, and they are not the same number.
 */
const DEFAULT_CALIBRATION_DAYS = 180

export interface IMessageSweepOptions {
  /** Sessions newer than this are written. Default 30. */
  days?: number
  /** Conversations read to calibrate the token filter. Default 180. */
  calibrationDays?: number
  /** Classify and report, write nothing. */
  dryRun?: boolean
  /** Read the live database instead of the snapshot (a human-run pass). */
  live?: boolean
}

export interface IMessageSweepResult {
  ok: boolean
  reason?: string
  dryRun: boolean
  chatsRead: number
  chatsClassified: number
  business: number
  internal: number
  excluded: number
  sessions: number
  inserted: number
  refreshed: number
  /** Redacted, so a log or a health page can carry it. */
  selected: { label: string; score: number; reason: string; sessions: number; messages: number }[]
  skippedConfidential: number
  tokensKept: number
  tokensDropped: number
  tokensRare: number
  calibrationDays: number
  ingestDays: number
  /** Sessions the model judged not work-related, whose text was discarded. */
  redacted: number
  chunksRemoved: number
}

export async function runIMessageSweep(
  opts: IMessageSweepOptions = {}
): Promise<IMessageSweepResult> {
  const dryRun = opts.dryRun ?? false
  const dbPath = opts.live ? undefined : snapshotDbPath()

  const base: IMessageSweepResult = {
    ok: false,
    dryRun,
    chatsRead: 0,
    chatsClassified: 0,
    business: 0,
    internal: 0,
    excluded: 0,
    sessions: 0,
    inserted: 0,
    refreshed: 0,
    selected: [],
    skippedConfidential: 0,
    tokensKept: 0,
    tokensDropped: 0,
    tokensRare: 0,
    calibrationDays: 0,
    ingestDays: 0,
    redacted: 0,
    chunksRemoved: 0,
  }

  const access = messagesReadable(dbPath)
  if (!access.ok) return { ...base, reason: access.reason }

  const ingestDays = opts.days ?? DEFAULT_INGEST_DAYS
  const calibrationDays = Math.max(opts.calibrationDays ?? DEFAULT_CALIBRATION_DAYS, ingestDays)
  const since = new Date(Date.now() - calibrationDays * 86_400_000)
  const ingestSince = Date.now() - ingestDays * 86_400_000
  const chats = readChats({ since, dbPath })
  base.chatsRead = chats.length

  const { targets, calibration, directory } = await buildTargets(chats)
  base.skippedConfidential = calibration.skippedConfidential
  base.tokensKept = calibration.keptTokens
  base.tokensDropped = calibration.dropped.length
  base.tokensRare = calibration.rareTokens
  base.calibrationDays = calibrationDays
  base.ingestDays = ingestDays

  const scored = scoreChats(chats, targets)
  base.chatsClassified = scored.length

  const threads = []
  for (const s of scored) {
    if (s.verdict.reason.startsWith('excluded number')) base.excluded += 1
    if (!s.verdict.business) continue
    base.business += 1
    if (s.verdict.internal) base.internal += 1

    // Closed sessions are to-thread's concern; which of them are in SCOPE is
    // this pass's. A session that closed six months ago is correct and old.
    const built = chatToThreads(s.chat, s.verdict, directory).filter(
      (t) => new Date(t.lastAt).getTime() >= ingestSince
    )
    if (built.length === 0) continue
    threads.push(...built)
    base.selected.push({
      label: s.label,
      score: s.verdict.score,
      reason: s.verdict.reason,
      sessions: built.length,
      messages: built.reduce((n, t) => n + t.messages.length, 0),
    })
  }
  base.sessions = threads.length
  base.selected.sort((a, b) => b.messages - a.messages)

  if (dryRun) return { ...base, ok: true }

  // The backstop. Summarize redacts a private session the moment it classifies
  // one, so this normally finds nothing — what it reaches is anything
  // summarized before that existed, or a session whose redaction failed.
  const redacted = await redactPrivateTexts()
  base.redacted = redacted.redacted
  base.chunksRemoved = redacted.chunksRemoved

  if (threads.length === 0) return { ...base, ok: true }

  const stored = await storeFetchedThreads(threads, 'deal')
  return { ...base, ok: true, inserted: stored.inserted, refreshed: stored.refreshed }
}
