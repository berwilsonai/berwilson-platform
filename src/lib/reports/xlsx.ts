/**
 * A real `.xlsx` workbook, written by hand over `fflate`.
 *
 * ── WHY NOT A LIBRARY, AND WHY NOT CSV ───────────────────────────────────────
 * CSV was the cheap answer and it is the wrong one. The single thing somebody
 * opens a pipeline export to do is sum a column, and `formatValue` renders
 * "$12B" — a column of those is text, Excel will not add it up, and the figure
 * cannot be charted or pivoted. Dates go the same way: "Nov 4, 2026" sorts
 * alphabetically, which puts April first.
 *
 * A library (`exceljs`, `xlsx`) would solve that and cost a dependency on a box
 * CLAUDE.md §2 records as having 314MB free with swap full. `fflate` is already
 * here and already reads OOXML — `src/lib/ai/document-text.ts` pulls `.xlsx`
 * and `.pptx` apart with it. An xlsx is a zip of six small XML files, so the
 * write direction is ~200 lines and no new dependency. Golden rule: never
 * introduce complexity without demonstrated need.
 *
 * ── WHAT THE WORKBOOK ACTUALLY CARRIES ───────────────────────────────────────
 *   · one worksheet per report section, named after it
 *   · a branded title block above the table
 *   · a frozen, filterable header row, so a 35-row sheet still scans at 350
 *   · real number formats, so money sums, dates sort and MW reads as MW
 *   · column widths that fit the content
 *
 * ⚠ INLINE STRINGS, NO `sharedStrings.xml`. The shared-string table saves space
 * on a sheet with heavy repetition and costs a whole second index to keep
 * consistent; these reports are tens of rows. One fewer file is one fewer way
 * to write a corrupt workbook.
 */

import { zipSync, strToU8 } from 'fflate'

import {
  toCell,
  type CellFormat,
  type CellInput,
  type ReportColumn,
  type ReportData,
  type ReportRow,
  type TableSection,
} from './types'
import { columnTotal, formatCell } from './format'

// ─────────────────────────────────────────────────────────────────────────────
// XML plumbing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ ESCAPED EVERY TIME, INCLUDING THE SHEET NAME. A deal called
 * "Riverdale / Box Elder" or an ampersand in a client's legal name produces a
 * workbook Excel refuses to open with no useful message — the failure mode is
 * a dialog saying the file is corrupt, which reads as a bug in the exporter
 * rather than in one row's data.
 */
function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are illegal in XML 1.0 and arrive inside pasted prose.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

/** 1 → A, 27 → AA. Columns are addressed by letter in every cell reference. */
function colName(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/**
 * An ISO day to an Excel serial.
 *
 * ⚠ THE OFFSET IS 25569 AND IT ENCODES A BUG ON PURPOSE. Excel reproduces a
 * Lotus error in which 1900 is a leap year, and that constant is what makes
 * modern dates land on the right square. Parsed from the string's own parts
 * rather than through `new Date(iso)`, which reads a bare `YYYY-MM-DD` as UTC
 * midnight and renders the previous day anywhere west of UTC — the identical
 * bug §12 records against the nine copies of the date formatter.
 */
function dateSerial(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return null
  const [, y, m, d] = match
  const utc = Date.UTC(Number(y), Number(m) - 1, Number(d))
  return Math.round(utc / 86_400_000) + 25569
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles. The index into `cellXfs` IS the contract; see the ⚠ on `xfs` below.
// ─────────────────────────────────────────────────────────────────────────────

/** The logo's terracotta, as Excel wants it: ARGB hex, no OKLCH. */
const BRAND = 'FFB4603F'
const BRAND_DEEP = 'FF8C4529'
const RULE = 'FFE7E5E1'

const STYLE = {
  title: 1,
  subtitle: 2,
  header: 3,
  group: 4,
  /** `bodyStyle()` / `totalStyle()` index off these. */
  bodyBase: 5,
  totalBase: 11,
  note: 17,
} as const

/** The order every `body`/`total` run follows. */
const FORMAT_ORDER: CellFormat[] = ['text', 'money', 'mw', 'date', 'number', 'percent']

function bodyStyle(format: CellFormat): number {
  return STYLE.bodyBase + FORMAT_ORDER.indexOf(format)
}
function totalStyle(format: CellFormat): number {
  return STYLE.totalBase + FORMAT_ORDER.indexOf(format)
}

/** Custom number formats. Ids below 164 are reserved by the spec. */
const NUM_FMT: Record<CellFormat, number> = {
  text: 0,
  money: 164,
  mw: 165,
  date: 166,
  number: 167,
  percent: 168,
}

function stylesXml(): string {
  const numFmts = [
    '<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/>',
    // One decimal only when there is one — a behind-the-meter tranche is
    // genuinely 12.5 MW and a round four hundred is "400 MW" (power.ts).
    '<numFmt numFmtId="165" formatCode="#,##0.#&quot; MW&quot;"/>',
    '<numFmt numFmtId="166" formatCode="mmm\\ d&quot;, &quot;yyyy"/>',
    '<numFmt numFmtId="167" formatCode="#,##0"/>',
    // A literal suffix, NOT the built-in percent format: `win_probability` is
    // stored 0–100, and Excel's percent format multiplies by 100, so a High
    // band of 80 would print as 8000%.
    '<numFmt numFmtId="168" formatCode="0&quot;%&quot;"/>',
  ].join('')

  const fonts = [
    '<font><sz val="11"/><color rgb="FF1C1917"/><name val="Calibri"/></font>',
    `<font><b/><sz val="18"/><color rgb="${BRAND_DEEP}"/><name val="Calibri"/></font>`,
    '<font><sz val="10"/><color rgb="FF78716C"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF1C1917"/><name val="Calibri"/></font>',
  ].join('')

  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    `<fill><patternFill patternType="solid"><fgColor rgb="${BRAND}"/><bgColor indexed="64"/></patternFill></fill>`,
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF5F3F0"/><bgColor indexed="64"/></patternFill></fill>',
  ].join('')

  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    `<border><left/><right/><top style="thin"><color rgb="${BRAND}"/></top><bottom/><diagonal/></border>`,
    `<border><left/><right/><top/><bottom style="thin"><color rgb="${RULE}"/></bottom><diagonal/></border>`,
  ].join('')

  /*
   * ⚠ THE ORDER OF THIS ARRAY IS THE `STYLE` MAP ABOVE. A row inserted here
   * without moving those constants silently restyles every cell that referenced
   * a later index — a workbook that opens perfectly and is wrong, which is the
   * worst of the two failures. `xlsx.test.ts` asserts the count and the offsets.
   */
  const xfs: string[] = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="4" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
  ]
  for (const format of FORMAT_ORDER) {
    const id = NUM_FMT[format]
    // Only the text column wraps; wrapping a money column makes Excel grow the
    // row height for a figure that was never going to need two lines.
    const wrap =
      format === 'text'
        ? ' applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        : '/>'
    xfs.push(
      `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"${wrap}`
    )
  }
  for (const format of FORMAT_ORDER) {
    xfs.push(
      `<xf numFmtId="${NUM_FMT[format]}" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>`
    )
  }
  xfs.push(
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1"/></xf>'
  )

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="5">${numFmts}</numFmts><fonts count="5">${fonts}</fonts><fills count="4">${fills}</fills><borders count="3">${borders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
}

/** How many `cellXfs` the stylesheet declares. Asserted by the test. */
export const STYLE_COUNT = 18

// ─────────────────────────────────────────────────────────────────────────────
// Sheet building
// ─────────────────────────────────────────────────────────────────────────────

interface SheetCell {
  value: string | number | null
  style: number
  /** Force the inline-string encoding even for a numeric-looking value. */
  text?: boolean
}

function cellXml(ref: string, cell: SheetCell): string {
  const { value, style } = cell
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}" s="${style}"/>`
  }
  if (typeof value === 'number' && !cell.text && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
}

function rowXml(index: number, cells: SheetCell[]): string {
  const body = cells.map((cell, i) => cellXml(`${colName(i + 1)}${index}`, cell)).join('')
  return `<row r="${index}">${body}</row>`
}

/** Every row of a section in reading order, group headings marked. */
function tableRows(section: TableSection): { row: ReportRow; group?: string }[] {
  if (section.groups) {
    return section.groups.flatMap((group) =>
      group.rows.map((row, i) => ({ row, group: i === 0 ? group.label : undefined }))
    )
  }
  return (section.rows ?? []).map((row) => ({ row }))
}

/** Every row across a section, ungrouped — what a total is computed over. */
export function allRows(section: TableSection): ReportRow[] {
  return section.groups ? section.groups.flatMap((g) => g.rows) : section.rows ?? []
}

/**
 * A cell's value as the workbook should hold it.
 *
 * ⚠ THE VALUE, NOT THE RENDERING — this is the whole reason the exporter does
 * not serialise what the screen shows. Money goes in as a number and takes a
 * currency format, a date becomes a serial so it sorts, and a megawatt figure
 * is a figure rather than "400 MW".
 *
 * ⚠ BUT A LABEL BEATS A *STRING* VALUE, AND GETTING THAT BACKWARDS PUT A RAW
 * ENUM IN THE SPREADSHEET. The first version of this returned
 * `String(cell.value)` for anything non-numeric, so a stage cell carrying
 * `{ value: 'prospecting', label: 'Prospecting' }` exported the column as
 * `prospecting` while the screen read "Prospecting" — §12: never print a
 * stored enum at a reader, and a spreadsheet is a reader. Caught by
 * `xlsx.test.ts`, which asserts the sheet contains the label and NOT the enum.
 *
 * The rule, stated once: a LABEL wins over a string (it is the human form of
 * the same thing); a NUMBER wins over a label (the label dresses a figure for
 * the eye, and the eye is not what opens Excel and sums a column).
 */
function sheetValue(input: CellInput, format: CellFormat): number | null | { text: string } {
  const cell = toCell(input)
  if (cell.value === null || cell.value === undefined || cell.value === '') {
    return cell.label ? { text: cell.label } : null
  }
  if (typeof cell.value === 'number') return cell.value
  if (format === 'date' && typeof cell.value === 'string') {
    const serial = dateSerial(cell.value)
    return serial === null ? { text: cell.label ?? cell.value } : serial
  }
  return { text: cell.label ?? String(cell.value) }
}

function defaultWidth(column: ReportColumn): number {
  const widths: Record<CellFormat, number> = {
    text: 30,
    money: 16,
    mw: 13,
    date: 14,
    number: 12,
    percent: 11,
  }
  return Math.max(widths[column.format], column.label.length + 4)
}

export function sheetXml(section: TableSection, meta: { title: string; subtitle?: string }): string {
  const columns = section.columns
  const rows: string[] = []
  let r = 1

  // ── Title block, then a blank line, then the table.
  rows.push(rowXml(r++, [{ value: meta.title, style: STYLE.title }]))
  if (meta.subtitle) rows.push(rowXml(r++, [{ value: meta.subtitle, style: STYLE.subtitle }]))
  if (section.description) rows.push(rowXml(r++, [{ value: section.description, style: STYLE.subtitle }]))
  rows.push(rowXml(r++, []))

  const headerRow = r
  rows.push(rowXml(r++, columns.map((c) => ({ value: c.label, style: STYLE.header }))))

  for (const { row, group } of tableRows(section)) {
    if (group) {
      rows.push(rowXml(r++, columns.map((_, i) => ({ value: i === 0 ? group : null, style: STYLE.group }))))
    }
    rows.push(
      rowXml(
        r++,
        columns.map((column) => {
          const resolved = sheetValue(row.cells[column.key] as CellInput, column.format)
          if (resolved !== null && typeof resolved === 'object') {
            return { value: resolved.text, style: bodyStyle(column.format), text: true }
          }
          return { value: resolved, style: bodyStyle(column.format) }
        })
      )
    )
  }

  const lastDataRow = r - 1

  if (section.totals) {
    const body = allRows(section)
    rows.push(
      rowXml(
        r++,
        columns.map((column, i) => {
          if (i === 0) {
            return {
              value: `Total — ${body.length} row${body.length === 1 ? '' : 's'}`,
              style: totalStyle('text'),
              text: true,
            }
          }
          if (!column.total) return { value: null, style: totalStyle(column.format) }
          return { value: columnTotal(body, column), style: totalStyle(column.format) }
        })
      )
    )
  }

  if (section.coverage) {
    rows.push(rowXml(r++, []))
    rows.push(rowXml(r++, [{ value: section.coverage, style: STYLE.note }]))
  }

  const cols = columns
    .map((column, i) => `<col min="${i + 1}" max="${i + 1}" width="${column.width ?? defaultWidth(column)}" customWidth="1"/>`)
    .join('')

  const lastCol = colName(Math.max(columns.length, 1))
  // Freeze the header AND filter on it. A 35-row sheet needs neither; the same
  // sheet next year does, and the reader who needs it will not come back to ask.
  const pane = `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>`
  const filter = lastDataRow > headerRow ? `<autoFilter ref="A${headerRow}:${lastCol}${lastDataRow}"/>` : ''

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData>${filter}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`
}

/**
 * A legal, unique sheet name.
 *
 * Excel's rules, each of which produces a corrupt-file dialog rather than an
 * error message: 31 characters, none of `[]:*?/\`, and no two sheets alike.
 */
export function sheetName(raw: string, taken: Set<string>): string {
  const base = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet'
  let name = base
  let n = 2
  while (taken.has(name.toLowerCase())) {
    const suffix = ` ${n++}`
    name = base.slice(0, 31 - suffix.length) + suffix
  }
  taken.add(name.toLowerCase())
  return name
}

/** A report with no table at all still exports: its stat band, two columns. */
function summarySheet(data: ReportData): TableSection {
  const stats = data.sections.flatMap((section) => (section.kind === 'stats' ? section.stats : []))
  return {
    kind: 'table',
    title: data.title,
    columns: [
      { key: 'label', label: 'Measure', format: 'text', width: 38 },
      { key: 'value', label: 'Value', format: 'text', width: 26 },
    ],
    rows: stats.map((stat, i) => ({
      id: `stat-${i}`,
      cells: { label: stat.label, value: stat.value ?? stat.empty ?? '—' },
    })),
    coverage: data.coverage,
  }
}

/**
 * Build the workbook.
 *
 * Only `table` sections become sheets — a stat band and a bar set are ways of
 * looking at figures the tables already carry, and a spreadsheet of three
 * headline numbers is a worse version of the page you just left. A report whose
 * sections are ALL non-tabular still produces a workbook, so the Excel button
 * is never a link to nothing.
 */
export function buildWorkbook(data: ReportData): Uint8Array {
  const tables = data.sections.filter((s): s is TableSection => s.kind === 'table')
  const taken = new Set<string>()
  const sheets =
    tables.length > 0
      ? tables.map((section) => ({
          name: sheetName(section.title, taken),
          body: sheetXml(section, {
            title: `${data.title} — ${section.title}`,
            subtitle: data.subtitle,
          }),
        }))
      : [
          {
            name: sheetName(data.title, taken),
            body: sheetXml(summarySheet(data), { title: data.title, subtitle: data.subtitle }),
          },
        ]

  const files: Record<string, Uint8Array> = {}

  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
  )

  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  )

  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`
  )

  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  )

  files['xl/styles.xml'] = strToU8(stylesXml())
  for (const [i, sheet] of sheets.entries()) {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheet.body)
  }

  return zipSync(files, { level: 6 })
}

/**
 * What the browser should call the file.
 *
 * Dated, because these get mailed and a folder of `pipeline.xlsx` is a folder
 * of one file. Seconds are left off deliberately — §12 wants them on a BACKUP
 * filename, where two runs an hour apart must not collide; a report exported
 * twice in one day should overwrite.
 */
export function workbookFilename(title: string, day: string, audience: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const tag = audience === 'external' ? '-shareable' : ''
  return `ber-wilson-${slug}${tag}-${day}.xlsx`
}

export { formatCell }
