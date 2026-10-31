/**
 * How a cell reads on a page, and how a column totals.
 *
 * ⚠ THIS IS NOT A SECOND SET OF FORMATTERS. Money goes through `formatValue` /
 * `formatMoney` and megawatts through `formatMegawatts`, both imported — §12
 * records five copies of the money formatter and nine of the date one, and the
 * whole point of `power.ts` owning `formatMegawatts` is that nothing else
 * prints MW. What lives here is only the mapping from a column's FORMAT to the
 * owner that renders it.
 */

import { formatDate, formatMoney, formatValue } from '@/lib/utils/constants'
import { formatMegawatts } from '@/lib/records/power'
import { toCell, type Cell, type CellFormat, type CellInput, type ReportColumn, type ReportRow } from './types'

/**
 * A cell as a reader sees it.
 *
 * `exact` asks for the unabbreviated form: a table on screen wants "$12B" in a
 * narrow column, and the same figure in a one-line total wants "$12,000,000,000"
 * where the reader is about to check it against a model. Both are `formatValue`
 * / `formatMoney`, never a third spelling.
 */
export function formatCell(cell: Cell, format: CellFormat, opts: { exact?: boolean } = {}): string {
  if (cell.label !== undefined) return cell.label
  const { value } = cell
  if (value === null || value === undefined || value === '') return '—'

  const renderers: Record<CellFormat, () => string> = {
    text: () => String(value),
    money: () =>
      typeof value === 'number' ? (opts.exact ? formatMoney(value) : formatValue(value)) : String(value),
    mw: () => (typeof value === 'number' ? formatMegawatts(value) : String(value)),
    date: () => formatDate(String(value)),
    number: () => (typeof value === 'number' ? value.toLocaleString('en-US') : String(value)),
    percent: () => (typeof value === 'number' ? `${Math.round(value)}%` : String(value)),
  }
  return renderers[format]()
}

/** Right for anything the eye scans as a quantity; left for words and dates. */
export function columnAlign(column: ReportColumn): 'left' | 'right' {
  if (column.align) return column.align
  const right: Record<CellFormat, boolean> = {
    text: false,
    money: true,
    mw: true,
    date: false,
    number: true,
    percent: true,
  }
  return right[column.format] ? 'right' : 'left'
}

/**
 * A column's total, or null when nothing in it was a number.
 *
 * ⚠ NULL, NOT 0, FOR A COLUMN OF BLANKS — §12: *"A rolled-up sum with nothing
 * in it is NULL, not 0."* Two priced deals in thirty-five is the live case, and
 * a value column reading "$0" under thirty-three blanks states a fact about the
 * portfolio that nobody entered.
 */
export function columnTotal(rows: readonly ReportRow[], column: ReportColumn): number | null {
  let sum = 0
  let seen = 0
  for (const row of rows) {
    const value = toCell(row.cells[column.key] as CellInput).value
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    sum += value
    seen += 1
  }
  return seen === 0 ? null : sum
}

/** How many rows carry a number in this column — the coverage half of a total. */
export function columnFilled(rows: readonly ReportRow[], column: ReportColumn): number {
  return rows.filter((row) => {
    const value = toCell(row.cells[column.key] as CellInput).value
    return typeof value === 'number' && Number.isFinite(value)
  }).length
}

/**
 * "2 of 35 priced" — or null when every row carries one.
 *
 * Mirrors `coverageNote` in `pipeline-value.ts` and `powerCoverageNote` in
 * `power.ts` deliberately: three surfaces saying the same thing three ways is
 * the drift those two modules exist to prevent.
 */
export function coverageFor(
  rows: readonly ReportRow[],
  column: ReportColumn,
  noun: string
): string | null {
  const filled = columnFilled(rows, column)
  if (filled === rows.length) return null
  if (rows.length === 0) return null
  return `${filled} of ${rows.length} ${noun}`
}
