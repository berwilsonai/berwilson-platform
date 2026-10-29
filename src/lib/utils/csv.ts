/**
 * CSV for the sheets the platform publishes to Drive — the one home.
 *
 * ⚠ EXTRACTED BEFORE IT WAS COPIED, which is the only cheap moment to do it.
 * This quoting was written once inside `src/lib/leads/sheet.ts` and the data-room
 * audit and the 00.2 tracker both wanted it next; §12's hardest fork to see is
 * two sibling modules written days apart, because neither looks like a copy.
 *
 * No imports, so a client component, a cron and a script can all reach it.
 */

/**
 * RFC 4180 quoting. A bid title with a comma in it must not shift every column.
 *
 * Newlines are flattened rather than quoted: a cell containing one is legal CSV
 * and renders as a multi-line row that breaks the eye-scan a published sheet
 * exists for.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value).replace(/\r?\n/g, ' ').trim()
  if (!text) return ''
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',')
}

/** Header row plus body, newline-joined — the shape `upsertSheetFromCsv` takes. */
export function csvDocument(header: readonly unknown[], rows: readonly unknown[][]): string {
  return [csvRow([...header]), ...rows.map(csvRow)].join('\n')
}
