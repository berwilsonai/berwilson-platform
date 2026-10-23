/**
 * THE MODEL COMPOSES PROSE; EVERY FIGURE IN THE OUTPUT MUST ALREADY BE IN THE
 * INPUT.
 *
 * This is the house rule, which the economics extractor also carried — "THE
 * MODEL FINDS FIGURES; CODE DOES THE ARITHMETIC AND THE COUNTING" — and it is
 * load-bearing here for a measured reason: handed a 69-row claim schedule the
 * local model answered 62. A miscount in a summary is embarrassing. A number it
 * invented in an OFFER TO PURCHASE is the most expensive single error this
 * system can make, so it is checked rather than hoped for.
 *
 * The test is deliberately not "is this figure right" — nothing can answer that
 * — but "did this figure come from somewhere". A money or percentage figure in
 * the finished document must appear in what the model was given: the deal's own
 * platform figures, the evidence it read, or the instructions the human typed.
 * Anything else was computed or imagined, and both are refused.
 *
 * ⚠ THE HUMAN'S OWN INSTRUCTION IS AN INPUT. Typing "offer $4.2M at closing"
 * authorises that figure, which is what makes the refusal recoverable rather
 * than a dead end: the way to get a number into a document is to say it.
 *
 * ⚠ MONEY AND PERCENTAGES ONLY, AND THAT IS THE WHOLE SCOPE. Dates, section
 * numbers, acreages, megawatt counts and "three parties" are numbers too, and
 * gating them would refuse honest documents constantly — §12: a static check
 * that gets broader gets wronger; narrow it until it has no false positives.
 * Money and percentages are where the harm is.
 */

import { formatMoney } from '@/lib/utils/constants'

/** A figure the platform knows, handed to the model as the figures it may use. */
export interface PlatformFigure {
  label: string
  /** The number itself, so it lands in the allowed set without being re-parsed. */
  amount: number
  kind: 'money' | 'percent'
  /** Where it came from, printed beside it so the model can cite it. */
  definition: string
}

export interface AllowedFigures {
  money: Set<number>
  percent: Set<number>
  /** Kept for the job row, so a verdict can be re-read after the fact. */
  platform: PlatformFigure[]
}

export interface UnsourcedFigure {
  /** Exactly as it appears in the document, for the message to the human. */
  text: string
  value: number
  kind: 'money' | 'percent'
}

/**
 * Multipliers, as the corpus actually writes them.
 *
 * `bn` is here because British-influenced correspondence uses it and this deal
 * set has plenty. `k` is lower-case only on purpose: a capital `K` next to a
 * number is far more often Kelvin or a part code than a thousand, and over-
 * matching a multiplier would make two different figures compare equal.
 */
const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  mm: 1_000_000,
  b: 1_000_000_000,
  bn: 1_000_000_000,
  million: 1_000_000,
  billion: 1_000_000_000,
  thousand: 1_000,
}

/**
 * `$1.2M`, `$135,000,000`, `$4.2 million`, `1.5% `, `9.0 percent`.
 *
 * Two patterns rather than one, because a leading `$` and a trailing `%` are
 * the only two things that reliably mark a number as the kind we care about.
 * A bare `135,000,000` is NOT matched: without a currency marker it is as
 * likely to be a square footage or a parcel number, and §12's rule about a
 * check getting broader and wronger applies.
 */
const MONEY_RE =
  /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(mm|bn|k|m|b|million|billion|thousand)?\b/gi
const PERCENT_RE = /(\d[\d,]*(?:\.\d+)?)\s*(?:%|percent\b)/gi

function parseAmount(digits: string, suffix: string | undefined): number | null {
  const base = Number(digits.replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  const mult = suffix ? MULTIPLIERS[suffix.toLowerCase()] : undefined
  return mult ? base * mult : base
}

/**
 * Round to the cent before comparing.
 *
 * Floating point makes `1.2 * 1_000_000` and `1200000` differ in the last bits,
 * and a guard that refuses a document over a rounding artefact is a guard that
 * gets switched off.
 */
function canonical(value: number): number {
  return Math.round(value * 100) / 100
}

/** Every money and percentage figure in a piece of text. */
export function readFigures(text: string): { money: number[]; percent: number[] } {
  const money: number[] = []
  const percent: number[] = []

  for (const m of text.matchAll(MONEY_RE)) {
    const value = parseAmount(m[1], m[2])
    if (value != null) money.push(canonical(value))
  }
  for (const m of text.matchAll(PERCENT_RE)) {
    const value = parseAmount(m[1], undefined)
    if (value != null) percent.push(canonical(value))
  }
  return { money, percent }
}

/**
 * The set of figures the model is permitted to write.
 *
 * ⚠ EVERY INPUT THE MODEL SAW HAS TO BE PASSED HERE, or the guard refuses an
 * honest document. That coupling is the point: if a future caller hands the
 * model a new source of prose, the guard must be told about it in the same
 * change, and the refusal is what makes that impossible to forget.
 */
export function collectAllowedFigures(args: {
  instructions: string
  evidenceText: string
  platform: PlatformFigure[]
}): AllowedFigures {
  const money = new Set<number>()
  const percent = new Set<number>()

  for (const source of [args.instructions, args.evidenceText]) {
    const found = readFigures(source)
    found.money.forEach((v) => money.add(v))
    found.percent.forEach((v) => percent.add(v))
  }

  for (const figure of args.platform) {
    const value = canonical(figure.amount)
    if (figure.kind === 'money') money.add(value)
    else percent.add(value)
  }

  // A document that says "$0" or "no fee" is making a statement, not quoting a
  // figure, and zero is never evidence of arithmetic.
  money.add(0)
  percent.add(0)

  return { money, percent, platform: args.platform }
}

/**
 * Figures in the finished document that are in none of its inputs.
 *
 * Returns them rather than throwing: the caller refuses the document AND tells
 * the human which figures could not be traced, because "I could not source
 * $135M" is actionable where "refused" is not.
 */
export function unsourcedFigures(
  renderedText: string,
  allowed: AllowedFigures
): UnsourcedFigure[] {
  const offenders: UnsourcedFigure[] = []
  const seen = new Set<string>()

  for (const m of renderedText.matchAll(MONEY_RE)) {
    const value = parseAmount(m[1], m[2])
    if (value == null) continue
    const canon = canonical(value)
    if (allowed.money.has(canon)) continue
    const text = m[0].trim()
    if (seen.has(text)) continue
    seen.add(text)
    offenders.push({ text, value: canon, kind: 'money' })
  }

  for (const m of renderedText.matchAll(PERCENT_RE)) {
    const value = parseAmount(m[1], undefined)
    if (value == null) continue
    const canon = canonical(value)
    if (allowed.percent.has(canon)) continue
    const text = m[0].trim()
    if (seen.has(text)) continue
    seen.add(text)
    offenders.push({ text, value: canon, kind: 'percent' })
  }

  return offenders
}

/**
 * The refusal, in the words the human needs to act on it.
 *
 * Names the figures and says how to authorise one, because the recovery is to
 * put the number in the instruction — not to try again and hope.
 */
export function unsourcedMessage(offenders: UnsourcedFigure[]): string {
  const list = offenders.slice(0, 8).map((o) => o.text).join(', ')
  const more = offenders.length > 8 ? ` and ${offenders.length - 8} more` : ''
  return [
    `Refused: ${offenders.length === 1 ? 'a figure' : 'figures'} in the draft`,
    `(${list}${more}) ${offenders.length === 1 ? 'is' : 'are'} in none of the`,
    'records this was built from, so it was computed or invented rather than',
    'quoted. Re-run with the figure in your instructions if it is one you are',
    'setting yourself.',
  ].join(' ')
}

/**
 * The deal's own figures, as a block the model is told to work from.
 *
 * ⚠ EVERY FIGURE CARRIES ITS DEFINITION. §12 — a money figure must carry its
 * SHAPE, because annual, contract, one-time, asset and capture are five
 * different quantities and are never interchangeable. `pipelineValue()` returns
 * the definition alongside the number for exactly this reason, and handing the
 * model a bare total is how a capture figure ends up in a document calling
 * itself contract value.
 */
export function figureBlock(figures: PlatformFigure[]): string {
  if (figures.length === 0) {
    return [
      'NO FIGURES ARE ON FILE FOR THIS RECORD. Write the document without any,',
      'and where one is needed mark it [TO BE AGREED]. Do not estimate.',
    ].join(' ')
  }
  const lines = figures.map((f) => {
    const value = f.kind === 'money' ? formatMoney(f.amount) : `${f.amount}%`
    return `- ${f.label}: ${value} (${f.definition})`
  })
  return lines.join('\n')
}
