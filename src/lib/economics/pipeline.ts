/**
 * The one number the pipeline shows for a deal, and what that number IS.
 *
 * ⚠ IT RETURNS A FIGURE AND A DEFINITION TOGETHER, ON PURPOSE. `estimated_value`
 * was a single unlabelled numeric column holding $57.5B across eight projects:
 * Myton Rail at $48,000,000,000 beside the Alaska JV at $1,500,000, plainly not
 * the same quantity, with Stockton blank although the platform held an
 * 88,498-character proposal stating its $152.5M. No total built on that column
 * could be defended, and nothing on screen said which quantity it was.
 *
 * So every caller gets `definition` beside `amount` and is expected to show it.
 * One quantity, one definition, or the reader trusts none of them (CLAUDE.md
 * §12, 09-26).
 *
 * THE PREFERENCE ORDER, AND WHY IT IS NOT AN OVERWRITE. A computed capture
 * figure wins when there is one; a hand-entered `estimated_value` is used when
 * there is not. Filling a blank and overwriting a value are different acts and
 * only one of them is safe to automate (CLAUDE.md §12, 09-30), so the
 * calculator never writes over `estimated_value` and a reader can always see
 * which of the two they are looking at.
 *
 * Pure. No imports.
 */

export type PipelineValueSource = 'capture' | 'estimated' | 'none'

export interface PipelineValue {
  amount: number | null
  source: PipelineValueSource
  /** Shown to the reader. Never omit it: an unlabelled figure is the old bug. */
  definition: string
  /** Longer form, for a tooltip or a tile's second line. */
  hint: string
}

export interface PipelineValueInput {
  economics_capture_value?: number | string | null
  estimated_value?: number | string | null
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function pipelineValue(record: PipelineValueInput): PipelineValue {
  const capture = num(record.economics_capture_value)
  if (capture != null) {
    return {
      amount: capture,
      source: 'capture',
      definition: 'Ber Wilson capture',
      hint: 'net of SPV ownership: contract value, one-time revenue and credits that reach Ber Wilson',
    }
  }

  const estimated = num(record.estimated_value)
  if (estimated != null) {
    return {
      amount: estimated,
      source: 'estimated',
      definition: 'Estimated, unmodelled',
      hint: 'a figure entered by hand, not computed. Build an economics model to replace it',
    }
  }

  return {
    amount: null,
    source: 'none',
    definition: 'No value set',
    hint: 'nobody has priced this deal yet',
  }
}

/**
 * Sum a set of records for a KPI tile, reporting what the total is made of.
 *
 * ⚠ A MIXED TOTAL ANNOUNCES ITSELF. Adding a computed capture figure to a
 * hand-entered estimate produces a number that is neither, so the result says
 * how many of each went into it and the tile can say "4 modelled, 3 estimated"
 * rather than presenting one authoritative figure. A total that quietly mixes
 * definitions is exactly what this feature exists to end.
 */
export interface PipelineTotal {
  amount: number
  /** How many records contributed a computed capture figure. */
  modelled: number
  /** How many contributed a hand-entered estimate instead. */
  estimated: number
  /** How many contributed nothing. */
  unpriced: number
  /** True when the total is made of one kind of figure only. */
  consistent: boolean
}

export function pipelineTotal(records: readonly PipelineValueInput[]): PipelineTotal {
  let amount = 0
  let modelled = 0
  let estimated = 0
  let unpriced = 0

  for (const record of records) {
    const value = pipelineValue(record)
    if (value.amount == null) {
      unpriced += 1
      continue
    }
    amount += value.amount
    if (value.source === 'capture') modelled += 1
    else estimated += 1
  }

  return {
    amount,
    modelled,
    estimated,
    unpriced,
    consistent: modelled === 0 || estimated === 0,
  }
}

/** A short sentence naming what a mixed total is made of, or null when it is clean. */
export function mixedTotalNote(total: PipelineTotal): string | null {
  if (total.consistent) return null
  return `${total.modelled} modelled, ${total.estimated} estimated by hand`
}
