/**
 * What the classifier matches against, calibrated against this corpus.
 *
 * ⚠ THIS IS THE HALF THAT MAKES classify.ts WORK, AND IT USED TO LIVE IN THE
 * SURVEY SCRIPT. `classifyChat` is deliberately ignorant of the database — it
 * is handed tokens and phone numbers and counts them. Which tokens is the
 * whole problem, and the answer is a property of this company's record names
 * meeting this person's text history, so it has to be measured rather than
 * written down. Leaving that measurement in a hand-run script meant the
 * ingestion would have had to re-implement it: §12, never fork a shared pass —
 * add a caller.
 *
 * The survey prints what this selects. The sweep writes it. Same function, so
 * they cannot disagree about what counts as business.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import {
  classifyChat,
  nameTokens,
  normalizePhone,
  termRegex,
  type ChatVerdict,
  type ClassifyInput,
} from './classify'
import type { ChatRow } from './read'
import type { Directory } from './to-thread'

/** The corpus-wide half of a {@link ClassifyInput} — everything not per-chat. */
export type ClassifyTargets = Pick<
  ClassifyInput,
  'partyPhones' | 'recordTokens' | 'tokensPerRecord' | 'rareTokens' | 'excludedHandles' | 'internalHandles'
>

/**
 * Messages the classifier judges a conversation on, newest first.
 *
 * A classifier needs a sample, not all of it. The cap lives here rather than in
 * the read so that ingestion can have every message in the window while the
 * verdict is still computed on exactly what the survey showed.
 */
export const CLASSIFY_SAMPLE = 400

export function classifySample(chat: ChatRow): string[] {
  return chat.messages.slice(0, CLASSIFY_SAMPLE).map((m) => m.text)
}

/**
 * ⚠ CALIBRATE THE TOKENS AGAINST THE CORPUS. THIS IS THE WHOLE FIX.
 *
 * The first run of the survey selected 94.4% of a personal message history —
 * 400 of 822 conversations including a 3,689-message rugby group chat — because
 * record names tokenize into ordinary English. `Case Garage` contributed
 * **case**, `Harvest Time Holdings` contributed **time**, and `State of Utah
 * Department of Workforce Services` contributed **state** and **services**. A
 * hand-written stopword list cannot anticipate that.
 *
 * So the corpus decides. A token appearing in more than COMMON_SHARE of
 * conversations is, by definition, not identifying here — measured rather than
 * chosen, which §12 insists on for every threshold.
 */
const COMMON_SHARE = 0.03

/**
 * ⚠ A TOKEN THAT CAN NAME A RECORD BY ITSELF NEEDS A MUCH HARDER BAR — TWO
 * TIERS, NOT ONE CUTOFF.
 *
 * The 3% cutoff is the right bar for a token that only ever fires ALONGSIDE
 * another one. It is far too loose for a word that identifies a record on its
 * own: the second survey run dropped `case` and kept `garage`, which left
 * `Case Garage` matching on "garage" alone and still claiming a 3,836-message
 * personal thread. `Renew Development` did the same through "renew".
 *
 * So a distinctive token must be genuinely rare — under half a percent of
 * conversations. Measured here: `premier` 1, `corridor` 1, `tonga` 1,
 * `wendover` 2, `workforce` 2, `dino` 3, `elite` 3 — against `hospital` 8,
 * `airport` 9, `gold` 10, `services` 11, `american` 14. The first list names a
 * deal; the second is what a year of family texts says anyway. That keeps place
 * names like `wendover`, which is what actually identifies these records.
 */
const RARE_TOKEN_SHARE = 0.005

export interface Calibration {
  records: number
  candidateTokens: number
  keptTokens: number
  partyPhones: number
  skippedConfidential: number
  chatCount: number
  commonCutoff: number
  rareCutoff: number
  dropped: { token: string; chats: number; from: string }[]
  rareTokens: number
}

/**
 * Build the match targets, pruned against the conversations they will be run
 * over.
 *
 * Takes the corpus because the pruning is a document-frequency count across it.
 * A caller that has not read the chats yet cannot calibrate, and an uncalibrated
 * token set selects almost everything.
 */
export async function buildTargets(
  chats: ChatRow[]
): Promise<{ targets: ClassifyTargets; calibration: Calibration; directory: Directory }> {
  const supabase = createAdminClient()

  const [projects, parties, entities, teamRows] = await Promise.all([
    supabase.from('projects').select('name, confidential'),
    supabase.from('parties').select('full_name, phone, email, is_organization'),
    supabase.from('entities').select('name'),
    supabase.from('team_members').select('name, email, parties(phone)'),
  ])

  /**
   * ⚠ CONFIDENTIAL PROJECT NAMES ARE NOT USED AS MATCH TOKENS.
   *
   * Matching on them would make the survey's output report which conversations
   * mention a protected deal — turning a containment boundary into a disclosure
   * in the one artifact meant to be read and shared. A protected deal's texts
   * are simply not sought. Containment, not access (§12): there is no viewer
   * here to unlock it for, and this runs in a cron with no user at all.
   */
  const candidates = new Map<string, string>()
  const tokensPerLabel = new Map<string, string[]>()
  let skippedConfidential = 0

  const offer = (name: string | null, confidential = false) => {
    if (!name) return
    if (confidential) {
      skippedConfidential += 1
      return
    }
    const toks = nameTokens(name)
    if (toks.length === 0) return
    tokensPerLabel.set(name, toks)
    for (const t of toks) if (!candidates.has(t)) candidates.set(t, name)
  }

  for (const p of (projects.data ?? []) as { name: string; confidential: boolean }[]) {
    offer(p.name, p.confidential)
  }
  for (const e of (entities.data ?? []) as { name: string | null }[]) offer(e.name)
  for (const p of (parties.data ?? []) as { full_name: string | null; is_organization: boolean }[]) {
    // Organisations only. A person's surname is a common word far more often
    // than a company name is — "Rich" or "White" would match half the corpus.
    if (p.is_organization) offer(p.full_name)
  }

  const partyPhones = new Set<string>()
  const nameByPhone = new Map<string, string>()
  const emailByPhone = new Map<string, string>()
  for (const p of (parties.data ?? []) as {
    phone: string | null
    full_name: string | null
    email: string | null
  }[]) {
    const n = p.phone ? normalizePhone(p.phone) : null
    if (!n) continue
    partyPhones.add(n)
    // First writer wins: two records on one number is a directory problem, and
    // guessing which is current here would hide it.
    if (p.full_name && !nameByPhone.has(n)) nameByPhone.set(n, p.full_name)
    if (p.email && !emailByPhone.has(n)) emailByPhone.set(n, p.email)
  }

  type TeamRow = { name: string; email: string | null; parties: { phone: string | null } | null }
  const team = (teamRows.data ?? []) as TeamRow[]

  /**
   * ⚠ THE OWNER IS NEITHER INTERNAL NOR A COUNTERPARTY — THEY ARE THE READER.
   *
   * `knownParty` means "someone we have on file is in this conversation", and
   * it clears the whole bar by itself. Richard has a party record with his own
   * number, so his notes-to-self thread was selected on the strength of being
   * himself — 427 messages qualifying with no record named and no deal term in
   * them. The same shape as printing a reader's own name back at them as a
   * third party. The owner is the team member on PRIMARY_MAILBOX, which is the
   * identity the mail stack already uses.
   */
  const ownerRow = team.find(
    (t) => t.email && t.email.toLowerCase() === PRIMARY_MAILBOX.toLowerCase()
  )
  const ownerPhone = ownerRow?.parties?.phone
  const ownerNormalized = ownerPhone ? normalizePhone(ownerPhone) : null
  if (ownerNormalized) {
    partyPhones.delete(ownerNormalized)
    nameByPhone.delete(ownerNormalized)
    emailByPhone.delete(ownerNormalized)
  }
  const ownerName = ownerRow?.name ?? 'Me'

  /**
   * Colleagues are INTERNAL, not excluded — and the difference cost a round
   * trip. Eric's thread was excluded by name on 2026-10-11 because it is 3,654
   * messages and scored like a deal thread. He is the CEO of a two-person
   * company and his texts are primarily work, so excluding him removed the
   * richest vein of real obligation in the corpus.
   *
   * `IMESSAGE_INTERNAL_HANDLES` carries the number a colleague actually texts
   * from where `parties.phone` does not — Eric's record holds …5507 and he
   * texts from …6519. `IMESSAGE_EXCLUDE_HANDLES` survives for what it is
   * actually for: a number whose conversations must never be read at all. It is
   * empty by default.
   */
  const excludedHandles = new Set<string>()
  const internalHandles = new Set<string>()

  for (const t of team) {
    if (t.email && t.email.toLowerCase() === PRIMARY_MAILBOX.toLowerCase()) continue
    const n = t.parties?.phone ? normalizePhone(t.parties.phone) : null
    if (n) internalHandles.add(n)
  }
  for (const raw of (process.env.IMESSAGE_INTERNAL_HANDLES ?? '').split(',')) {
    const n = normalizePhone(raw.trim())
    if (n) internalHandles.add(n)
  }
  for (const raw of (process.env.IMESSAGE_EXCLUDE_HANDLES ?? '').split(',')) {
    const n = normalizePhone(raw.trim())
    if (n) excludedHandles.add(n)
  }
  // A number cannot be both; an explicit exclusion is the stronger statement.
  for (const n of excludedHandles) internalHandles.delete(n)

  // ── Prune the tokens against the corpus ───────────────────────────────────
  const sampled = chats.map((c) => ({ chat: c, bodies: classifySample(c) }))
  const withText = sampled.filter((s) => s.bodies.length > 0)

  const df = new Map<string, number>()
  for (const s of withText) {
    const hay = s.bodies.join('\n').toLowerCase()
    for (const token of candidates.keys()) {
      if (termRegex(token).test(hay)) df.set(token, (df.get(token) ?? 0) + 1)
    }
  }

  const chatCount = withText.length
  const commonCutoff = Math.max(2, Math.ceil(chatCount * COMMON_SHARE))
  const rareCutoff = Math.max(1, Math.ceil(chatCount * RARE_TOKEN_SHARE))

  const dropped: Calibration['dropped'] = []
  const recordTokens = new Map<string, string>()
  for (const [token, label] of candidates) {
    const n = df.get(token) ?? 0
    if (n >= commonCutoff) dropped.push({ token, chats: n, from: label })
    else recordTokens.set(token, label)
  }

  // Surviving tokens per record: the denominator for "was the whole name
  // named". Tokens dropped as ordinary are deliberately not counted — they
  // carry no identity here, so requiring them would make coverage unreachable.
  const tokensPerRecord = new Map<string, string[]>()
  for (const [label, toks] of tokensPerLabel) {
    const surviving = toks.filter((t) => recordTokens.has(t))
    if (surviving.length > 0) tokensPerRecord.set(label, surviving)
  }

  const rareTokens = new Set<string>()
  for (const token of recordTokens.keys()) {
    if ((df.get(token) ?? 0) <= rareCutoff) rareTokens.add(token)
  }

  return {
    targets: { partyPhones, recordTokens, tokensPerRecord, rareTokens, excludedHandles, internalHandles },
    directory: { nameByPhone, emailByPhone, ownerName },
    calibration: {
      records: tokensPerLabel.size,
      candidateTokens: candidates.size,
      keptTokens: recordTokens.size,
      partyPhones: partyPhones.size,
      skippedConfidential,
      chatCount,
      commonCutoff,
      rareCutoff,
      dropped,
      rareTokens: rareTokens.size,
    },
  }
}

export interface ScoredChat {
  chat: ChatRow
  verdict: ChatVerdict
  /**
   * Redacted: a display name if the conversation has one, else the last four
   * digits. Enough to recognise, not a copy of the address book.
   */
  label: string
}

/** Judge every conversation. One definition, so the survey predicts the sweep. */
export function scoreChats(chats: ChatRow[], targets: ClassifyTargets): ScoredChat[] {
  const out: ScoredChat[] = []
  for (const chat of chats) {
    const messages = classifySample(chat)
    if (messages.length === 0) continue
    const verdict = classifyChat({
      handles: chat.handles,
      messages,
      sentByMe: chat.sentByMe,
      total: chat.total,
      ...targets,
    })
    out.push({ chat, verdict, label: redactedLabel(chat) })
  }
  return out
}

export function redactedLabel(chat: ChatRow): string {
  return (
    chat.displayName?.trim() ||
    (chat.handles.length > 1
      ? `group of ${chat.handles.length} (…${(chat.handles[0] ?? '').slice(-4)} +)`
      : `…${(chat.handles[0] ?? '?').slice(-4)}`)
  )
}
