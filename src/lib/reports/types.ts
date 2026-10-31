/**
 * The shape every report is, regardless of where it lands.
 *
 * ── WHY ONE SHAPE ────────────────────────────────────────────────────────────
 * A report has three destinations — the screen, a branded PDF, an Excel file —
 * and §12 is blunt about what happens when a pass grows a second destination by
 * forking: *"Never fork a shared pass — add a target"*, and *"A destination that
 * does not carry what creating carries reads as losing the work."* The forked
 * copy of `runDocumentAiPass` silently discarded 413,000 characters.
 *
 * So a report BUILDER returns data, never markup. One builder, three renderers,
 * and a column added to the pipeline table appears in the spreadsheet and the
 * PDF the same afternoon without anyone remembering to add it twice.
 *
 * ⚠ A CELL CARRIES ITS VALUE, NOT ITS RENDERING. `formatValue` produces
 * "$12.0B", which is right on a page and useless in a spreadsheet — a column of
 * those is text, Excel will not sum it, and the one thing somebody opens Excel
 * to do is sum a column. So the cell holds the NUMBER and the column holds the
 * FORMAT, and each renderer applies the format its medium understands: a string
 * on screen, a numFmt code in the workbook.
 */

import type { Tone } from '@/lib/ui/tone'

/**
 * How a column's values are read.
 *
 * ⚠ THIS IS A VOCABULARY AND IT IS TYPED AS ONE. Every switch over it below is
 * a `Record<CellFormat, …>`, so adding a member is a build error in the screen
 * renderer, the print renderer and the workbook writer at once — which is the
 * §12 fix that actually ends the drift ("THE FIX THAT ENDS IT IS THE TYPE, NOT
 * THE DERIVATION"). A `switch` with a trailing `default` would have let a new
 * format render as a bare number in one of the three and nowhere say so.
 */
export const CELL_FORMATS = ['text', 'money', 'mw', 'date', 'number', 'percent'] as const
export type CellFormat = (typeof CELL_FORMATS)[number]

/** A value plus, optionally, how to say it. */
export interface Cell {
  /**
   * The underlying value. A number here is a number in Excel and a number in a
   * column total; a string is a string everywhere.
   *
   * ⚠ NULL IS ABSENT AND IS NOT 0. A deal with no estimated value and a deal
   * worth nothing are different facts, and `pipeline-value.ts` exists because
   * the platform spent months unable to tell them apart.
   */
  value: string | number | null
  /**
   * Rendered text, when it differs from the value — a stage's label over its
   * enum, a coverage note under a total. Excel takes the VALUE and ignores
   * this, except where the value is null and this is all there is.
   */
  label?: string
  /** Renders as a chip on screen and as plain text everywhere else. */
  tone?: Tone
  /** A deal's page, a Drive folder. Screen only; a PDF cannot be clicked on paper. */
  href?: string
}

/** What a builder may put in a row: the bare value, or a value plus its dress. */
export type CellInput = string | number | null | Cell

/** Normalise the loose form to the full one. One place, so no renderer guesses. */
export function toCell(input: CellInput): Cell {
  if (input !== null && typeof input === 'object') return input
  return { value: input }
}

export interface ReportColumn {
  /** Key into the row's cells. */
  key: string
  label: string
  format: CellFormat
  /** Defaults from the format: numbers right, everything else left. */
  align?: 'left' | 'right'
  /**
   * Drop this column when the report is prepared for someone outside the
   * company.
   *
   * ⚠ THE DEFAULT IS TO SHOW, WHICH IS THE SAFE DIRECTION ONLY BECAUSE THE
   * AUDIENCE IS AN EXPLICIT PARAMETER AND THE STRIPPING HAPPENS AT ONE CHOKE
   * POINT (`applyAudience`). §12's rule is that a security filter belongs at
   * the choke point as a DEFAULT rather than as something every caller passes —
   * and that is satisfied here by the filter running over the finished
   * `ReportData` rather than inside each of the five builders.
   */
  internal?: boolean
  /** Sum this column in the table's footer. Only meaningful for a numeric format. */
  total?: boolean
  /** Rough character width, used to size the spreadsheet column. */
  width?: number
}

export interface ReportRow {
  /** Stable key for React. A record id where there is one. */
  id: string
  cells: Record<string, CellInput>
  /** Renders bolder — a group subtotal inside the body. */
  emphasis?: boolean
  /** A second line under the first cell. Screen and print only. */
  detail?: string
}

/** A run of rows under a heading, with its own subtotal. */
export interface RowGroup {
  label: string
  tone?: Tone
  rows: ReportRow[]
  /** Shown beside the group heading — "8 deals · 1,200 MW". */
  summary?: string
}

export interface TableSection {
  kind: 'table'
  title: string
  /** One sentence under the heading. Omitted entirely when absent — never an em dash. */
  description?: string
  columns: ReportColumn[]
  /** Flat rows, or grouped. A builder picks one; both is a bug. */
  rows?: ReportRow[]
  groups?: RowGroup[]
  /** Footer totals row. */
  totals?: boolean
  /** What the figures above do and do not cover. Printed under the table. */
  coverage?: string
  internal?: boolean
  /** Shown instead of an empty table. */
  empty?: string
}

export interface StatsSection {
  kind: 'stats'
  title: string
  description?: string
  stats: {
    label: string
    value: string | null
    /** Shown when `value` is null — never a bare em dash at a value's weight. */
    empty?: string
    hint?: string
    tone?: Tone
    /**
     * Drop this TILE for an outside reader.
     *
     * ⚠ A SECTION-LEVEL FLAG WAS NOT ENOUGH AND THE GAP SHIPPED A LEAK. The
     * first version marked only whole sections and COLUMNS internal, so the
     * shareable pipeline PDF correctly dropped the Win band and Weighted
     * COLUMNS and then printed "WEIGHTED VALUE $11.9B" as a headline tile two
     * inches above them — the probability-weighted figure, which is our own
     * read on whether we win, at the largest type size on the page. §12: a
     * security filter belongs at the choke point, and a filter applied to one
     * shape and not its sibling is the shape that leaks. Found by rendering
     * the shareable cut rather than by trusting the flag.
     */
    internal?: boolean
  }[]
  internal?: boolean
}

/**
 * A horizontal bar set — a stage mix, capacity by year.
 *
 * Deliberately not a charting library. These are five-to-eight bars of one
 * series, which is a `<div>` with a width, and it prints. A dependency that
 * draws on a canvas does not print at all.
 */
export interface BarsSection {
  kind: 'bars'
  title: string
  description?: string
  /** Bars are drawn against this; null means scale to the largest bar. */
  max?: number | null
  bars: {
    label: string
    value: number
    /** The figure as the reader should see it — "1,200 MW", "8 deals". */
    display: string
    tone?: Tone
    /** A second, muted figure on the right. */
    note?: string
  }[]
  coverage?: string
  internal?: boolean
}

/** A standing caveat — what the report cannot see. */
export interface NoteSection {
  kind: 'note'
  title: string
  body: string
  tone?: Tone
  internal?: boolean
}

export type ReportSection = TableSection | StatsSection | BarsSection | NoteSection

export interface ReportData {
  title: string
  /** The one line under the title on the letterhead. */
  subtitle?: string
  /**
   * What the whole report covers and does not — the §12 rule that a filtered
   * list's totals are part of the list, and that withheld rows must be counted
   * rather than silently absent.
   */
  coverage?: string
  /** How many rows were withheld because their deal is confidential. */
  withheld?: number
  sections: ReportSection[]
}

/**
 * Who the document is for.
 *
 * ⚠ TWO AUDIENCES, AND ONLY ONE OF THEM MAY SEE A PROTECTED DEAL — in fact
 * neither does. A report is a cross-portfolio surface, and §4 is unambiguous
 * that a confidential project leaves EVERY cross-portfolio surface, step-up or
 * not: a step-up opens that project's own pages, it does not put it back into
 * the portfolio totals. So the builders filter on `confidentialProjectIds()`
 * rather than on the viewer, and this flag governs only the INTERNAL columns.
 */
export const AUDIENCES = ['internal', 'external'] as const
export type ReportAudience = (typeof AUDIENCES)[number]

export function isAudience(value: unknown): value is ReportAudience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value)
}

export const AUDIENCE_LABELS: Record<ReportAudience, string> = {
  internal: 'Internal',
  external: 'For sharing',
}

export const AUDIENCE_HINTS: Record<ReportAudience, string> = {
  internal: 'Everything, including win probability and capture notes.',
  external: 'Internal-only columns removed. Safe to send outside the company.',
}

/**
 * Strip what an outside reader may not see.
 *
 * ONE function, run over the finished report, rather than a flag threaded
 * through five builders — §12: *"A security filter belongs at the choke point
 * as a DEFAULT, not as a parameter every caller passes."* A builder added next
 * year is covered by this without its author knowing the rule exists, provided
 * they mark the column.
 */
export function applyAudience(data: ReportData, audience: ReportAudience): ReportData {
  if (audience === 'internal') return data

  const sections = data.sections
    .filter((section) => !section.internal)
    .map((section): ReportSection => {
      // A stat band keeps its non-internal tiles; see the ⚠ on `stats` above.
      if (section.kind === 'stats') {
        return { ...section, stats: section.stats.filter((stat) => !stat.internal) }
      }
      if (section.kind !== 'table') return section
      const columns = section.columns.filter((column) => !column.internal)
      const keep = new Set(columns.map((column) => column.key))
      const strip = (row: ReportRow): ReportRow => ({
        ...row,
        cells: Object.fromEntries(Object.entries(row.cells).filter(([key]) => keep.has(key))),
      })
      return {
        ...section,
        columns,
        rows: section.rows?.map(strip),
        groups: section.groups?.map((group) => ({ ...group, rows: group.rows.map(strip) })),
      }
    })

  return { ...data, sections }
}
