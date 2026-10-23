/**
 * The one number the pipeline shows for a deal, and what that number IS.
 *
 * ⚠ THIS USED TO LIVE IN src/lib/economics/pipeline.ts AND MOVED HERE WHEN THE
 * CALCULATOR WAS REMOVED (2026-10-23). The module was never the engine — it is
 * the rule that a figure on screen must say which quantity it is, plus the
 * hierarchy arithmetic that stops a program and its sub-projects being counted
 * twice. Both outlive the calculator and neither needs it.
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
 * ⚠ THERE IS NOW ONE SOURCE, AND THAT IS THE POINT OF THE CHANGE. The computed
 * `economics_capture_value` branch is gone with the engine, so a deal's value
 * is whatever a human typed into `estimated_value` and nothing else. The
 * `source` union keeps its 'capture' member OUT rather than retaining a member
 * nothing can ever set: a taxonomy member that never fires is a second schema
 * that drifts silently (§12). When the Excel model comes back into the
 * platform, this is the one file that decides what the pipeline reads, and the
 * member goes back in here first.
 *
 * Pure. No imports.
 */

export type PipelineValueSource = 'estimated' | 'none'

export interface PipelineValue {
  amount: number | null
  source: PipelineValueSource
  /** Shown to the reader. Never omit it: an unlabelled figure is the old bug. */
  definition: string
  /** Longer form, for a tooltip or a tile's second line. */
  hint: string
}

export interface PipelineValueInput {
  estimated_value?: number | string | null
}

/**
 * ⚠ AN EMPTY OR BLANK STRING IS ABSENT, NOT 0. `Number('')` is 0, so the
 * version of this function that came over with the module would have rendered a
 * blank `estimated_value` as "$0" — a figure about the deal that nobody typed,
 * which is the one thing every rule in this file exists to prevent. Caught by
 * the test below on the port (2026-10-23); the original had no case for it.
 */
function num(value: number | string | null | undefined): number | null {
  if (value == null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function pipelineValue(record: PipelineValueInput): PipelineValue {
  const estimated = num(record.estimated_value)
  if (estimated != null) {
    return {
      amount: estimated,
      source: 'estimated',
      definition: 'Estimated deal value',
      hint: 'a figure entered by hand on this record, not computed',
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
 * ⚠ THE COUNTS SURVIVED THE CALCULATOR AND SHOULD. `estimated` and `unpriced`
 * still tell a reader how much of the portfolio the total actually covers,
 * which is the question a bare sum cannot answer: "$1.2B" over 30 deals means
 * something different when 29 of them are blank.
 */
export interface PipelineTotal {
  amount: number
  /** How many records contributed a figure. */
  estimated: number
  /** How many contributed nothing. */
  unpriced: number
}

export function pipelineTotal(records: readonly PipelineValueInput[]): PipelineTotal {
  let amount = 0
  let estimated = 0
  let unpriced = 0

  for (const record of records) {
    const value = pipelineValue(record)
    if (value.amount == null) {
      unpriced += 1
      continue
    }
    amount += value.amount
    estimated += 1
  }

  return { amount, estimated, unpriced }
}

/**
 * A short sentence naming how much of a set the total actually covers, or null
 * when every record contributed.
 *
 * ⚠ IT REPLACES `mixedTotalNote`, WHICH ANSWERED A QUESTION THAT NO LONGER
 * EXISTS. There is only one kind of figure now, so nothing can be mixed — but
 * the honest caveat on a portfolio total moved rather than went away, because
 * a sum over 1 of 30 priced deals is the figure most likely to be misread.
 */
export function coverageNote(total: PipelineTotal): string | null {
  if (total.unpriced === 0) return null
  const priced = total.estimated
  const all = priced + total.unpriced
  if (priced === 0) return `none of ${all} priced`
  return `${priced} of ${all} priced`
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
 * program carrying its own figure alongside children carrying theirs is counted
 * TWICE in each, which at fifty deals is a portfolio figure nobody can defend.
 *
 * THE RULE, and it is the simplest one that holds: A DEAL'S VALUE LIVES ON
 * LEAVES. A parent's value is the sum of its leaves and never its own figure. A
 * program is a container for work, and its figure is what the work inside it
 * adds up to.
 *
 * ⚠ A PARENT WITH NO CHILDREN IS A LEAF. That is what keeps the rule safe
 * against the normal case, and the behaviour only changes for a record that
 * actually contains others.
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
 * ⚠ IT REPORTS THE OVERRULED FIGURE. A program whose own `estimated_value` is
 * being ignored in favour of its sub-projects must say so on screen, or the
 * next person to type a number on the program wonders why it never appeared.
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
  const note = coverageNote(total)
  return {
    // ⚠ NULL, NOT 0, WHEN NOTHING INSIDE IS PRICED. A program of four unpriced
    // sub-projects showing "$0" states a fact about the deal that nobody made
    // (§12, 10-05); the caller renders null by naming the absence in words.
    amount: total.estimated > 0 ? total.amount : null,
    source: total.estimated > 0 ? 'estimated' : 'none',
    definition: `Rolled up from ${leaves.length} sub-project${leaves.length === 1 ? '' : 's'}`,
    hint: note
      ? `the sum of what the work inside adds up to — ${note}`
      : 'the sum of what the work inside adds up to; the program carries no figure of its own',
    rolled: true,
    leaves: leaves.length,
    ownValue: own.amount == null ? null : own,
  }
}
