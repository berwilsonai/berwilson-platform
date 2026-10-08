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

// ─────────────────────────────────────────────────────────────────────────────
// HIERARCHY. A program and its sub-projects are not two deals.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ WHY THIS EXISTS. `parent_project_id` has been on `projects` since the
 * original schema and was used by 0 of 14 rows, so nothing had ever exercised
 * the arithmetic — and the arithmetic was wrong in three places at once:
 * `projects/[id]/page.tsx` totalled `[project, ...children]`, the dashboard
 * summed every project flat, and the pipeline board's stage columns did too. A
 * program carrying its own economics model alongside children carrying theirs
 * is counted TWICE in each, which at fifty deals is a portfolio figure nobody
 * can defend — the exact failure `pipelineValue` was built to end.
 *
 * THE RULE, and it is the simplest one that holds: ECONOMICS LIVES ON LEAVES. A
 * parent's value is the sum of its leaves and never its own model. A program is
 * a container for work, and its figure is what the work inside it adds up to.
 *
 * ⚠ A PARENT WITH NO CHILDREN IS A LEAF. That is what keeps the rule safe
 * against the normal case: 14 of 14 projects today have no children, so every
 * one of them counts, and the behaviour only changes for a record that actually
 * contains others.
 */
export interface HierarchyRecord extends PipelineValueInput {
  id: string
  parent_project_id?: string | null
}

/**
 * The records that carry the portfolio's value: every record with no child
 * present in the same set.
 *
 * ⚠ "PRESENT IN THE SAME SET" IS LOAD-BEARING. A filtered or access-scoped list
 * may hold a child whose parent was dropped, or a parent whose children were.
 * Judging parenthood by the column alone would make a child whose parent is
 * absent vanish from its own total — and `dropHidden` (confidential projects)
 * produces exactly that set. So a parent only loses its own figure when its
 * children are actually here to replace it.
 */
export function leafRecords<T extends HierarchyRecord>(records: readonly T[]): T[] {
  const hasChild = new Set<string>()
  for (const record of records) {
    if (record.parent_project_id) hasChild.add(record.parent_project_id)
  }
  return records.filter((record) => !hasChild.has(record.id))
}

/** Every descendant of `id` present in the set, to any depth. */
export function descendantsOf<T extends HierarchyRecord>(
  id: string,
  records: readonly T[]
): T[] {
  const byParent = new Map<string, T[]>()
  for (const record of records) {
    if (!record.parent_project_id) continue
    const list = byParent.get(record.parent_project_id)
    if (list) list.push(record)
    else byParent.set(record.parent_project_id, [record])
  }

  const out: T[] = []
  const seen = new Set<string>([id])
  const queue = [id]
  while (queue.length > 0) {
    for (const child of byParent.get(queue.shift()!) ?? []) {
      // Guards a cycle. `parent_project_id` has no constraint preventing one,
      // and an infinite loop in a server component is a hung page rather than
      // an error anybody sees.
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      queue.push(child.id)
    }
  }
  return out
}

export interface PortfolioTotal extends PipelineTotal {
  /**
   * How many records were held out as containers of others. Shown to the
   * reader: a total over 50 deals that silently covers 44 is the kind of
   * unexplained figure this module exists to stop.
   */
  rolledUp: number
}

/**
 * The total for a SET of records — the dashboard tile, a stage column, the
 * whole portfolio — counting each deal once.
 *
 * Use this and not `pipelineTotal` wherever the set could contain a parent and
 * its children at the same time, which is any list read straight from
 * `projects`.
 */
export function portfolioTotal(records: readonly HierarchyRecord[]): PortfolioTotal {
  const leaves = leafRecords(records)
  return { ...pipelineTotal(leaves), rolledUp: records.length - leaves.length }
}

export interface RolledPipelineValue extends PipelineValue {
  /** True when this figure is the sum of children rather than the record's own. */
  rolled: boolean
  /** How many leaves contributed. 0 when the record answered for itself. */
  leaves: number
  /**
   * The record's OWN figure when it has one and is being rolled up anyway.
   * Shown as superseded rather than dropped: ignoring a number and saying you
   * ignored it are different acts (§12).
   */
  ownValue: PipelineValue | null
}

/**
 * One record's value, rolled up from its descendants when it has any.
 *
 * ⚠ IT REPORTS THE OVERRULED FIGURE. A program whose own `economics_capture_value`
 * is being ignored in favour of its sub-projects must say so on screen, or the
 * next person to model the program wonders why their number never appeared.
 */
export function rolledPipelineValue<T extends HierarchyRecord>(
  record: T,
  records: readonly T[]
): RolledPipelineValue {
  const own = pipelineValue(record)
  const leaves = leafRecords([record, ...descendantsOf(record.id, records)])
  const isLeaf = leaves.length === 1 && leaves[0]?.id === record.id

  if (isLeaf) {
    return { ...own, rolled: false, leaves: 0, ownValue: null }
  }

  const total = pipelineTotal(leaves)
  const note = mixedTotalNote(total)
  const priced = total.modelled + total.estimated
  return {
    // ⚠ NULL, NOT 0, WHEN NOTHING INSIDE IS PRICED. A program of four unpriced
    // sub-projects showing "$0" states a fact about the deal that nobody made
    // (§12, 10-05); the caller renders null by naming the absence in words.
    amount: priced > 0 ? total.amount : null,
    // The WEAKEST definition present, because a total containing one
    // hand-entered guess is no better evidenced than that guess. No fourth
    // 'mixed' member: `mixedTotalNote` already says it in words, and a new
    // enum member would silently never fire at every existing reader (§12 on
    // taxonomies as second schemas).
    source: total.estimated > 0 ? 'estimated' : total.modelled > 0 ? 'capture' : 'none',
    definition: `Rolled up from ${leaves.length} sub-project${leaves.length === 1 ? '' : 's'}`,
    hint: note
      ? `the sum of what the work inside adds up to — ${note}`
      : 'the sum of what the work inside adds up to; the program carries no figure of its own',
    rolled: true,
    leaves: leaves.length,
    ownValue: own.amount == null ? null : own,
  }
}
