import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unzipSync, strFromU8 } from 'fflate'

import { buildWorkbook, sheetName, workbookFilename, STYLE_COUNT } from './xlsx'
import { applyAudience, isAudience, type ReportData } from './types'
import { columnTotal, formatCell } from './format'

/**
 * ⚠ THE WORKBOOK IS UNZIPPED AND READ BACK, NEVER JUST BUILT.
 *
 * Every failure mode of a hand-written xlsx produces the same symptom: Excel
 * shows a dialog saying the file is corrupt and offers to repair it, with no
 * indication of which part is wrong. A test that asserts `bytes.length > 0`
 * would pass through every one of them. So these open the archive and read the
 * XML — §12: *"A verification script whose `finally` calls `process.exit`
 * swallows the throw"*, and more to the point, *"a script reading a TRUNCATED
 * set is worse than none, because it is believed."*
 */

function openWorkbook(data: ReportData) {
  const files = unzipSync(buildWorkbook(data))
  return {
    files,
    text: (path: string) => strFromU8(files[path]),
    names: Object.keys(files),
  }
}

const SAMPLE: ReportData = {
  title: 'Pipeline Summary',
  subtitle: 'Every live deal, by stage',
  coverage: '3 deals — 2 projects, 1 opportunity',
  sections: [
    {
      kind: 'stats',
      title: 'The portfolio',
      stats: [{ label: 'Deals', value: '3' }],
    },
    {
      kind: 'table',
      title: 'Every deal',
      columns: [
        { key: 'name', label: 'Deal', format: 'text' },
        { key: 'stage', label: 'Stage', format: 'text' },
        { key: 'capacity', label: 'Capacity', format: 'mw', total: true },
        { key: 'value', label: 'Value', format: 'money', total: true },
        { key: 'pwin', label: 'Win band', format: 'text', internal: true },
        { key: 'bid', label: 'Bid due', format: 'date' },
      ],
      groups: [
        {
          label: 'Prospecting',
          rows: [
            {
              id: 'a',
              cells: {
                name: 'Steelton & Sons <Phase 1>',
                stage: { value: 'prospecting', label: 'Prospecting', tone: 'neutral' },
                capacity: 400,
                value: 12_000_000_000,
                pwin: 'High',
                bid: '2026-11-04',
              },
            },
            {
              id: 'b',
              cells: {
                name: 'Riverdale Site',
                stage: { value: 'prospecting', label: 'Prospecting' },
                capacity: null,
                value: null,
                pwin: null,
                bid: null,
              },
            },
          ],
        },
      ],
      totals: true,
      coverage: '1 of 2 deals priced',
    },
  ],
}

// ── buildWorkbook
test('xlsx — writes every part a reader needs to open the file', () => {
    const book = openWorkbook(SAMPLE)
    // The six parts of a minimal OOXML spreadsheet. A missing one is the
    // "file is corrupt" dialog with no further explanation.
  for (const part of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
  ]) {
    assert.ok(book.names.includes(part), `missing part: ${part}`)
  }
  })

test('xlsx — declares exactly as many relationships as sheets, plus styles', () => {
    const book = openWorkbook(SAMPLE)
    const rels = book.text('xl/_rels/workbook.xml.rels')
    const sheets = book.names.filter((n) => n.startsWith('xl/worksheets/')).length
    // ⚠ OFF-BY-ONE HERE IS THE COMMONEST WAY TO SHIP A BROKEN WORKBOOK: the
    // styles relationship shares the rId sequence with the sheets, so adding a
    // sheet without bumping it points `styles.xml` at a worksheet.
    assert.equal(rels.match(/<Relationship /g)?.length, sheets + 1)
    assert.ok(rels.includes('Target="styles.xml"'))
  })

test('xlsx — declares the style count the STYLE map indexes into', () => {
    const book = openWorkbook(SAMPLE)
    const styles = book.text('xl/styles.xml')
    const declared = /<cellXfs count="(\d+)"/.exec(styles)?.[1]
    // The `STYLE` constants are raw indices into this array. If it shrinks,
    // every cell silently takes a different format — a workbook that opens
    // perfectly and is wrong, which is the worse of the two failures.
    assert.equal(Number(declared), STYLE_COUNT)
    assert.equal(styles.match(/<xf /g)?.length, STYLE_COUNT + 1) // +1 for cellStyleXfs
  })

test('xlsx — writes money and megawatts as NUMBERS so Excel can sum them', () => {
    const sheet = openWorkbook(SAMPLE).text('xl/worksheets/sheet1.xml')
    // The whole reason this is not a CSV. A `<v>` is a number; a `t="inlineStr"`
    // is text, and a column of text is a column Excel will not add up.
    assert.ok(sheet.includes('<v>12000000000</v>'), 'expected to contain ' + '<v>12000000000</v>')
    assert.ok(sheet.includes('<v>400</v>'), 'expected to contain ' + '<v>400</v>')
  })

test('xlsx — writes a date as a serial, not as a string', () => {
    const sheet = openWorkbook(SAMPLE).text('xl/worksheets/sheet1.xml')
    // 2026-11-04. Computed independently of the implementation: days from the
    // 1899-12-30 epoch Excel uses, which is the constant a typo would break.
    const expected = Math.round(Date.UTC(2026, 10, 4) / 86_400_000) + 25569
    assert.ok(sheet.includes(`<v>${expected}</v>`), 'expected to contain ' + `<v>${expected}</v>`)
    assert.ok(!sheet.includes('2026-11-04'), 'should not contain ' + '2026-11-04')
  })

test('xlsx — escapes a name that would otherwise produce an unopenable file', () => {
    const sheet = openWorkbook(SAMPLE).text('xl/worksheets/sheet1.xml')
    // `&` and `<` are the two characters that turn a workbook into the corrupt
    // dialog, and both arrive in real deal names.
    assert.ok(sheet.includes('Steelton &amp; Sons &lt;Phase 1&gt;'), 'expected to contain ' + 'Steelton &amp; Sons &lt;Phase 1&gt;')
    assert.ok(!/Steelton & Sons/.test(sheet))
  })

test('xlsx — prints a cell LABEL rather than its enum value', () => {
    const sheet = openWorkbook(SAMPLE).text('xl/worksheets/sheet1.xml')
    assert.ok(sheet.includes('Prospecting'), 'expected to contain ' + 'Prospecting')
    // §12: never print a stored enum at a reader, and a spreadsheet is a reader.
    assert.ok(!sheet.includes('>prospecting<'), 'should not contain ' + '>prospecting<')
  })

test('xlsx — freezes and filters the header row', () => {
    const sheet = openWorkbook(SAMPLE).text('xl/worksheets/sheet1.xml')
    assert.ok(sheet.includes('state="frozen"'), 'expected to contain ' + 'state="frozen"')
      // Title, subtitle, blank, then the header on row 4 and two data rows under
  // their group heading. Written out rather than computed, so a change to the
  // title block has to be looked at rather than absorbed.
  assert.ok(sheet.includes('<autoFilter ref="A4:F7"/>'), 'header row or data range moved')
  })

test('xlsx — drops internal columns for an outside reader, in every rendering', () => {
    const external = applyAudience(SAMPLE, 'external')
    const sheet = openWorkbook(external).text('xl/worksheets/sheet1.xml')
    // The column header is gone AND so is the value — a filter that strips the
    // heading and leaves the data is the worst possible outcome.
    assert.ok(!sheet.includes('Win band'), 'should not contain ' + 'Win band')
    assert.ok(!sheet.includes('High'), 'should not contain ' + 'High')
    // And the columns that are not internal survive.
    assert.ok(sheet.includes('Capacity'), 'expected to contain ' + 'Capacity')
  })

test('xlsx — exports a report with no table at all', () => {
    // The Excel button must never be a link to nothing.
    const statsOnly: ReportData = {
      title: 'Stats only',
      sections: [{ kind: 'stats', title: 'Figures', stats: [{ label: 'Deals', value: '3' }] }],
    }
    const book = openWorkbook(statsOnly)
    assert.ok(book.names.includes('xl/worksheets/sheet1.xml'))
    assert.ok(book.text('xl/worksheets/sheet1.xml').includes('Deals'))
  })

test('xlsx — names one sheet per table section, legally and uniquely', () => {
    const taken = new Set<string>()
    // Excel's rules: 31 chars, none of []:*?/\, no duplicates. Each one
    // produces the corrupt-file dialog rather than an error.
    // The illegal characters become spaces and the runs then collapse, so
  // `Room: 00/01 [draft]` lands as one single-spaced name rather than one
  // pocked with double spaces.
  assert.equal(sheetName('Room: 00/01 [draft]', taken), 'Room 00 01 draft')
  assert.equal(sheetName('Room: 00/01 [draft]', taken), 'Room 00 01 draft 2')
    assert.equal(sheetName('x'.repeat(50), taken).length, 31)
    assert.equal(sheetName('', taken), 'Sheet')
  })

test('xlsx — names the file by report, day and audience', () => {
    assert.equal(workbookFilename('Pipeline Summary', '2026-10-31', 'internal'), 'ber-wilson-pipeline-summary-2026-10-31.xlsx')
    assert.equal(workbookFilename('Pipeline Summary', '2026-10-31', 'external'), 'ber-wilson-pipeline-summary-shareable-2026-10-31.xlsx')
  })

// ── totals and coverage
  const rows = [
    { id: 'a', cells: { value: 100, name: 'A' } },
    { id: 'b', cells: { value: null, name: 'B' } },
  ]

test('xlsx — sums only the rows that carry a number', () => {
    assert.equal(columnTotal(rows, { key: 'value', label: 'Value', format: 'money' }), 100)
  })

test('xlsx — returns NULL, never 0, for a column of blanks', () => {
    // §12: a rolled-up sum with nothing in it is NULL, not 0. Two priced deals
    // in thirty-five is the live case, and "$0" under thirty-three blanks
    // states a fact about the portfolio that nobody entered.
    const blank = [{ id: 'a', cells: { value: null } }]
    assert.equal(columnTotal(blank, { key: 'value', label: 'Value', format: 'money' }), null)
  })

// ── formatCell
test('xlsx — never renders a figure without its unit', () => {
    assert.equal(formatCell({ value: 400 }, 'mw'), '400 MW')
    assert.equal(formatCell({ value: 12.5 }, 'mw'), '12.5 MW')
    assert.equal(formatCell({ value: 12_000_000_000 }, 'money'), '$12B')
    assert.equal(formatCell({ value: 80 }, 'percent'), '80%')
  })

test('xlsx — renders an absent value as an em dash, and a label over a value', () => {
    assert.equal(formatCell({ value: null }, 'money'), '—')
    assert.equal(formatCell({ value: 'prospecting', label: 'Prospecting' }, 'text'), 'Prospecting')
  })

// ── the audience filter
/*
 * ⚠ THESE EXIST BECAUSE THE FILTER LEAKED IN ITS FIRST FORM. It handled whole
 * sections and table COLUMNS, so the shareable pipeline PDF dropped the Win
 * band and Weighted columns and then printed "WEIGHTED VALUE $11.9B" as a
 * headline tile above them. §12: a security filter belongs at the choke point
 * — and the way to prove one is at the choke point is to test every SHAPE a
 * report can hold, not the one the bug was found in.
 */
const EVERY_SHAPE: ReportData = {
  title: 'Every shape',
  sections: [
    {
      kind: 'stats',
      title: 'Tiles',
      stats: [
        { label: 'Public tile', value: 'keep me' },
        { label: 'Private tile', value: 'SECRET-STAT', internal: true },
      ],
    },
    {
      kind: 'table',
      title: 'Columns',
      columns: [
        { key: 'open', label: 'Open', format: 'text' },
        { key: 'shut', label: 'Shut', format: 'text', internal: true },
      ],
      rows: [{ id: 'r', cells: { open: 'keep me', shut: 'SECRET-CELL' } }],
    },
    { kind: 'note', title: 'Private note', body: 'SECRET-NOTE', internal: true },
    { kind: 'note', title: 'Public note', body: 'keep me' },
    {
      kind: 'bars',
      title: 'Private bars',
      bars: [{ label: 'SECRET-BAR', value: 1, display: '1' }],
      internal: true,
    },
  ],
}

test('audience — nothing marked internal survives in ANY shape', () => {
  const external = applyAudience(EVERY_SHAPE, 'external')
  // Serialised whole, so a shape nobody thought to filter is still caught:
  // a new section kind that forgets the flag fails here rather than in a PDF.
  const json = JSON.stringify(external)
  for (const secret of ['SECRET-STAT', 'SECRET-CELL', 'SECRET-NOTE', 'SECRET-BAR']) {
    assert.ok(!json.includes(secret), `${secret} reached an external report`)
  }
  // And the same for the workbook, which is a separate renderer.
  const sheet = strFromU8(unzipSync(buildWorkbook(external))['xl/worksheets/sheet1.xml'])
  assert.ok(!sheet.includes('SECRET-CELL'), 'SECRET-CELL reached the shareable workbook')
})

test('audience — internal keeps everything', () => {
  const json = JSON.stringify(applyAudience(EVERY_SHAPE, 'internal'))
  for (const secret of ['SECRET-STAT', 'SECRET-CELL', 'SECRET-NOTE', 'SECRET-BAR']) {
    assert.ok(json.includes(secret), `${secret} was dropped from the internal report`)
  }
})

test('audience — an unrecognised value is not an audience', () => {
  // The routes fall back to `internal` on anything unknown, which shows MORE.
  // That is the safe direction only because `external` must be asked for by
  // name — assert the guard actually refuses, so the fallback cannot invert.
  for (const bad of ['', 'External', 'public', 'INTERNAL', null, undefined, 1]) {
    assert.equal(isAudience(bad), false, `${String(bad)} was accepted as an audience`)
  }
  assert.equal(isAudience('internal'), true)
  assert.equal(isAudience('external'), true)
})
