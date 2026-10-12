/**
 * The Google Sheets API, for spreadsheets this app created.
 *
 * WHY THIS EXISTS ALONGSIDE upsertSheetFromCsv
 *
 * `upsertSheetFromCsv` (google-drive-write.ts) goes through the DRIVE API: it
 * uploads a CSV and lets Drive convert it to a Sheet. That needs no Sheets API
 * at all, which is why the lead sheets have worked for weeks with the Sheets
 * API switched off in the Cloud project. It also cannot do two things the task
 * board needs, and both are structural rather than awkward:
 *
 *   1. A CSV is ONE tab. There is no CSV that produces a four-tab workbook.
 *   2. A checkbox is a Sheets concept (a BOOLEAN data-validation rule), not a
 *      cell value. CSV can write the word "FALSE"; it cannot make something a
 *      phone will tick.
 *
 * SCOPE. Everything here runs under `drive.file` — the Sheets API honours it
 * for files the app itself created, which is every file this module ever
 * touches. No `spreadsheets` scope is requested and none should be: that one
 * grants read/write over every spreadsheet in the account, and the narrow grant
 * is the whole reason the Drive write tier is safe to hold (§8).
 *
 * ⚠ THE API MUST BE ENABLED ON THE CLOUD PROJECT, AND THE FAILURE IS A 403
 * THAT LOOKS LIKE A PERMISSION PROBLEM. It is not — it is a switch in the Cloud
 * console, and no amount of re-consenting fixes it. {@link SheetsApiDisabledError}
 * exists so a caller can say which of the two it is, because telling them apart
 * by eye costs an afternoon: one is a console click, the other is a re-consent.
 *
 * Plain fetch through googleFetch, no SDK — same house style as every other
 * integration here (§11: no vendor client libraries in the runtime path).
 */

import { googleFetch, PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

/**
 * The Sheets API is switched off in the Cloud project.
 *
 * Distinct from a scope failure on purpose. Google answers both with 403 and
 * the bodies read similarly to a human in a hurry, but the remedies share
 * nothing: this one is one click in the Cloud console and needs no token work,
 * while a scope failure needs a mailbox to re-consent in a browser.
 */
export class SheetsApiDisabledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SheetsApiDisabledError'
  }
}

/** The stored consent predates a scope this call needs. */
export class SheetsScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SheetsScopeError'
  }
}

/**
 * Re-throw Google's failure as something a caller can branch on.
 *
 * Matches the prose `explainTokenError` has already translated rather than
 * re-parsing the raw body — that function owns the mapping from Google's error
 * codes to English, and duplicating its patterns here is how the two drift.
 */
function classify(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('the required API is not enabled')) {
    throw new SheetsApiDisabledError(message)
  }
  if (message.includes('the stored consent predates a scope')) {
    throw new SheetsScopeError(message)
  }
  throw err instanceof Error ? err : new Error(message)
}

/**
 * One call, with Google's 403s translated into something branchable.
 *
 * ⚠ BODIES GO OUT AS PLAIN OBJECTS, NOT PRE-STRINGIFIED. `googleFetch`
 * serializes `init.body` itself and sets the content type when one is present,
 * so a JSON string would be double-encoded — and a `headers` key does not
 * typecheck at all, because GoogleRequestInit has no such field. Worth stating
 * because every other Google integration in this repo goes through
 * `driveWrite`, which takes a real `RequestInit` and wants the opposite.
 */
async function sheetsFetch<T>(
  path: string,
  mailbox: string,
  init?: Parameters<typeof googleFetch>[2]
): Promise<T> {
  try {
    return await googleFetch<T>(`${SHEETS_BASE}${path}`, mailbox, init)
  } catch (err) {
    classify(err)
  }
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

/** One tab. `sheetId` is the numeric handle every formatting request takes. */
export interface SheetTab {
  sheetId: number
  title: string
  rowCount: number
  columnCount: number
}

export interface SpreadsheetRef {
  spreadsheetId: string
  spreadsheetUrl: string
}

/**
 * Create a spreadsheet, owned by `mailbox` and parented in My Drive root.
 *
 * The Sheets API has no `parents`, so the caller moves it afterwards with
 * `moveFileToFolder`. Doing it in that order rather than creating through Drive is
 * deliberate: a Sheets-API create returns a real spreadsheet with a known
 * first tab, where a Drive create of an empty `application/vnd.google-apps.
 * spreadsheet` returns a file whose tab layout has to be read back anyway.
 */
export async function createSpreadsheet(
  title: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<SpreadsheetRef> {
  return sheetsFetch<SpreadsheetRef>('?fields=spreadsheetId,spreadsheetUrl', mailbox, {
    method: 'POST',
    body: { properties: { title } },
  })
}

/**
 * The tabs a spreadsheet currently has.
 *
 * Read every run rather than cached in our own table. The tab set is Google's
 * state, not ours, and a content hash cannot detect a change made on the far
 * side of the API (§12, 08-26) — somebody renaming or deleting a tab by hand is
 * exactly the case a cache would get wrong, silently and for good.
 */
export async function listTabs(
  spreadsheetId: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<SheetTab[]> {
  const data = await sheetsFetch<{
    sheets?: {
      properties?: {
        sheetId?: number
        title?: string
        gridProperties?: { rowCount?: number; columnCount?: number }
      }
    }[]
  }>(
    `/${spreadsheetId}?fields=sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))`,
    mailbox
  )
  return (data.sheets ?? []).flatMap((s) => {
    const p = s.properties
    if (!p || p.sheetId === undefined || !p.title) return []
    return [
      {
        sheetId: p.sheetId,
        title: p.title,
        rowCount: p.gridProperties?.rowCount ?? 0,
        columnCount: p.gridProperties?.columnCount ?? 0,
      },
    ]
  })
}

/** Does this spreadsheet still exist and answer? Used to detect a hand-deletion. */
export async function spreadsheetExists(
  spreadsheetId: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<boolean> {
  try {
    await sheetsFetch<unknown>(`/${spreadsheetId}?fields=spreadsheetId`, mailbox)
    return true
  } catch (err) {
    // A disabled API or a missing scope must NOT read as "the file is gone" —
    // that would have the caller create a second workbook every run and leave a
    // trail of abandoned ones. Only a 404 means absent.
    if (err instanceof SheetsApiDisabledError || err instanceof SheetsScopeError) throw err
    const message = err instanceof Error ? err.message : String(err)
    if (/\b404\b/.test(message)) return false
    throw err
  }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A cell as the API accepts it. `null` writes an empty cell. */
export type CellValue = string | number | boolean | null

/**
 * Read several ranges in one request.
 *
 * `UNFORMATTED_VALUE` is load-bearing: it returns a checkbox as a real boolean
 * rather than the string "TRUE", and a date as a serial number rather than
 * whatever the viewer's locale renders. Anything that has to be compared is
 * read this way.
 *
 * A range with no data comes back with `values` ABSENT rather than empty, which
 * is why every caller gets `[]` from here instead of `undefined` to forget
 * about.
 */
export async function batchGetValues(
  spreadsheetId: string,
  ranges: string[],
  mailbox: string = PRIMARY_MAILBOX
): Promise<Map<string, CellValue[][]>> {
  const out = new Map<string, CellValue[][]>()
  if (ranges.length === 0) return out

  const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')
  const data = await sheetsFetch<{
    valueRanges?: { range?: string; values?: CellValue[][] }[]
  }>(`/${spreadsheetId}/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&${query}`, mailbox)

  // Keyed by POSITION, not by the returned `range` string: Google normalises
  // ranges it echoes back ("Richard!A1:C50" becomes "Richard!A1:C50" usually,
  // but a quoted tab title comes back quoted), so matching on the echo would
  // miss any tab whose name needs quoting — which is every tab with a space in
  // it. The response is documented to preserve request order.
  ranges.forEach((requested, i) => {
    out.set(requested, data.valueRanges?.[i]?.values ?? [])
  })
  return out
}

/**
 * Write several rectangles in one request.
 *
 * `RAW` rather than `USER_ENTERED`: a task title that happens to start with `=`
 * or `+` must land as text, not be parsed as a formula. The one place
 * USER_ENTERED is needed is the boolean written under a checkbox, and `RAW`
 * handles a real JSON `true`/`false` correctly, so nothing needs the parser.
 */
export async function batchUpdateValues(
  spreadsheetId: string,
  data: { range: string; values: CellValue[][] }[],
  mailbox: string = PRIMARY_MAILBOX
): Promise<void> {
  if (data.length === 0) return
  await sheetsFetch(`/${spreadsheetId}/values:batchUpdate`, mailbox, {
    method: 'POST',
    body: { valueInputOption: 'RAW', data },
  })
}

// ---------------------------------------------------------------------------
// Structural / formatting requests
// ---------------------------------------------------------------------------

/**
 * A `batchUpdate` request. Deliberately loose.
 *
 * The Sheets request union has well over a hundred arms and typing the handful
 * used here would be a second schema to keep in step with Google's — the exact
 * failure §12 names for a taxonomy written into a prompt. The builders below
 * are the typed surface; this is the wire shape they produce.
 */
export type SheetRequest = Record<string, unknown>

/** Apply structural changes. Returns the replies, positionally. */
export async function batchUpdate(
  spreadsheetId: string,
  requests: SheetRequest[],
  mailbox: string = PRIMARY_MAILBOX
): Promise<Record<string, unknown>[]> {
  if (requests.length === 0) return []
  const data = await sheetsFetch<{ replies?: Record<string, unknown>[] }>(
    `/${spreadsheetId}:batchUpdate`,
    mailbox,
    { method: 'POST', body: { requests } }
  )
  return data.replies ?? []
}

/** Add a tab with a frozen header row. */
export function addTabRequest(title: string, columnCount: number): SheetRequest {
  return {
    addSheet: {
      properties: {
        title,
        gridProperties: { rowCount: 1000, columnCount, frozenRowCount: 1 },
      },
    },
  }
}

/** The `sheetId` an addSheet reply carries, or null if the reply was not one. */
export function addedTabId(reply: Record<string, unknown> | undefined): number | null {
  const added = reply?.addSheet as { properties?: { sheetId?: number } } | undefined
  return added?.properties?.sheetId ?? null
}

export function renameTabRequest(sheetId: number, title: string): SheetRequest {
  return { updateSheetProperties: { properties: { sheetId, title }, fields: 'title' } }
}

/**
 * Grow a tab so a write cannot fall off the end of the grid.
 *
 * Sheets rejects a values.update whose range exceeds the grid, and a tab
 * created with 1000 rows is one bad week of task creation away from that. Only
 * ever grows: shrinking would discard whatever a person had typed below.
 */
export function ensureRowsRequest(sheetId: number, have: number, need: number): SheetRequest | null {
  if (need <= have) return null
  return {
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { rowCount: need } },
      fields: 'gridProperties.rowCount',
    },
  }
}

/** Bold, non-wrapping header row. */
export function headerStyleRequest(sheetId: number, columnCount: number): SheetRequest {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true },
          wrapStrategy: 'CLIP',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)',
    },
  }
}

/**
 * Turn a column into real checkboxes.
 *
 * `showCustomUi: true` is what makes it a tickable box rather than a validated
 * text cell — without it the rule still rejects a non-boolean but renders as an
 * ordinary cell, which on a phone is untappable. Applied over a generous row
 * span so a row added by a later run is already a checkbox.
 */
export function checkboxColumnRequest(
  sheetId: number,
  columnIndex: number,
  throughRow: number
): SheetRequest {
  return {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: Math.max(2, throughRow),
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      rule: { condition: { type: 'BOOLEAN' }, showCustomUi: true },
    },
  }
}

/** Hide a column — used for the task id the read-back needs and nobody reads. */
export function hideColumnRequest(sheetId: number, columnIndex: number): SheetRequest {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: columnIndex, endIndex: columnIndex + 1 },
      properties: { hiddenByUser: true },
      fields: 'hiddenByUser',
    },
  }
}

/** Set one column's width in pixels. */
export function columnWidthRequest(
  sheetId: number,
  columnIndex: number,
  pixels: number
): SheetRequest {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: columnIndex, endIndex: columnIndex + 1 },
      properties: { pixelSize: pixels },
      fields: 'pixelSize',
    },
  }
}

/**
 * Wipe a tab's data rows, leaving the header and the formatting.
 *
 * `updateCells` with an empty `rows` and `fields: userEnteredValue` clears the
 * values without touching the data-validation rules — where `clear` on the
 * values endpoint would leave the checkboxes but a `repeatCell` with no format
 * fields would strip them. Rebuilding a projection whole is only safe if the
 * wipe is this precise.
 */
export function clearRowsRequest(sheetId: number, fromRow: number, toRow: number): SheetRequest {
  return {
    updateCells: {
      range: { sheetId, startRowIndex: fromRow, endRowIndex: Math.max(fromRow, toRow) },
      fields: 'userEnteredValue',
    },
  }
}

/** A basic filter over the header row, so every tab sorts and filters in place. */
export function basicFilterRequest(sheetId: number, columnCount: number): SheetRequest {
  return {
    setBasicFilter: {
      filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: columnCount } },
    },
  }
}

/**
 * Quote a tab title for use in an A1 range.
 *
 * A title with a space, an apostrophe or a bracket in it is a syntax error
 * unquoted, and the API's complaint names the range rather than the title —
 * which is a confusing way to learn that a person's tab is called "Pepper
 * Potts". Always quoted, which is valid for every title.
 */
export function a1(tabTitle: string, range: string): string {
  return `'${tabTitle.replace(/'/g, "''")}'!${range}`
}
