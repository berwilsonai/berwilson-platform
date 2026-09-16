/**
 * Build the checked-in prefab steel quote template.
 *
 *   node scripts/build-quote-template.mjs <source.docx>
 *
 * The source is Ber Wilson's own hand-authored quote. This script rebuilds its
 * BODY into the layout the platform generates from — reordering blocks, adding
 * the payment-breakdown tables, and inserting the {{TOKENS}} — while reusing the
 * source's own paragraphs and tables verbatim, so every style, colour, table
 * border, the logo and the page footer carry over untouched.
 *
 * Two things this has to get right, both learned the hard way:
 *
 * ⚠ GOOGLE MERGES ADJACENT TABLES. A `</w:tbl><w:tbl>` pair with no paragraph
 *   between them converts into ONE table, and the absorbed callout inherits the
 *   width of the first column of the table above it — which turned a 4-page
 *   document into 5 pages with three callouts collapsed into a third of the
 *   page. Every table here is therefore followed by a hairline spacer paragraph.
 *
 * ⚠ RUN ORDER IS THE CONTRACT. Each block's <w:t> elements are replaced in
 *   document order, so the arrays below are positional. A cell whose text is
 *   split across several runs would break that; the source happens to use one
 *   run per cell, which `--audit` re-checks.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const OUT = path.join(process.cwd(), 'assets', 'steel-quote-template.docx')

// ── docx body parsing ───────────────────────────────────────────────────────

function splitBlocks(body) {
  const blocks = []
  let i = 0
  while (i < body.length) {
    let matched = false
    for (const tag of ['w:p', 'w:tbl', 'w:sectPr']) {
      if (!body.startsWith('<' + tag, i)) continue
      if (!' >/'.includes(body[i + tag.length + 1])) continue
      let depth = 0
      let j = i
      for (;;) {
        const re = new RegExp(`<(/?)${tag}(?=[ >/])`, 'g')
        re.lastIndex = j
        const m = re.exec(body)
        if (!m) { j = body.length; break }
        const gt = body.indexOf('>', m.index)
        if (m[1] === '/') {
          depth -= 1
          if (depth === 0) { j = gt + 1; break }
        } else if (body[gt - 1] === '/') {
          if (depth === 0) { j = gt + 1; break }
        } else {
          depth += 1
        }
        j = gt + 1
      }
      blocks.push({ tag, xml: body.slice(i, j) })
      i = j
      matched = true
      break
    }
    if (!matched) i += 1
  }
  return blocks
}

const textOf = (xml) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1])

/** Replace a block's text runs positionally. `null` leaves a run alone. */
function retext(xml, values) {
  let k = 0
  return xml.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g, (full, open, _old, close) => {
    const v = values[k++]
    if (v === undefined || v === null) return full
    // xml:space="preserve" so a value with leading/trailing spaces survives.
    const tag = open.includes('xml:space') ? open : open.replace('<w:t', '<w:t xml:space="preserve"')
    return tag + escapeXml(v) + close
  })
}

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const rowsOf = (tbl) => {
  const out = []
  const re = /<w:tr(?=[ >])/g
  let m
  while ((m = re.exec(tbl))) {
    const end = tbl.indexOf('</w:tr>', m.index)
    out.push(tbl.slice(m.index, end + 7))
  }
  return out
}

/**
 * Rebuild a table's rows. Source rows are reused in order; when more rows are
 * needed than the source has, the body rows are cycled so the striped shading
 * keeps alternating, and the source's LAST row is always reused for the target's
 * last row (that is where a total row's green fill lives).
 */
function setRows(tbl, rows, { totalRow = false } = {}) {
  const src = rowsOf(tbl)
  const head = src[0]
  const body = src.slice(1, totalRow ? -1 : undefined)
  const tail = totalRow ? src[src.length - 1] : null

  const built = rows.map((values, idx) => {
    if (idx === 0) return retext(head, values)
    if (totalRow && idx === rows.length - 1) return retext(tail, values)
    return retext(body[(idx - 1) % body.length], values)
  })

  const first = tbl.indexOf(src[0])
  const last = tbl.lastIndexOf(src[src.length - 1]) + src[src.length - 1].length
  return tbl.slice(0, first) + built.join('') + tbl.slice(last)
}

/**
 * Re-shade one row. The acceptance table has no total row of its own, so the
 * Payment Summary borrows its structure and gets the green fill applied here —
 * the same fill the other total rows use, so "this is the number" reads the
 * same way everywhere in the document.
 */
function shadeRow(tbl, rowIndex, fill) {
  let i = 0
  return tbl.replace(/<w:tr(?=[ >])[\s\S]*?<\/w:tr>/g, (row) =>
    i++ === rowIndex ? row.replace(/(<w:shd[^>]*w:fill=")[0-9A-Fa-f]{6}/g, `$1${fill}`) : row
  )
}

/** Reset a 2- or 3-column table's column widths (twentieths of a point). */
function setWidths(tbl, widths) {
  let g = 0
  let out = tbl.replace(/<w:gridCol w:w="\d+"\s*\/>/g, () => `<w:gridCol w:w="${widths[g++] ?? 2000}"/>`)
  const perRow = (row) => {
    let c = 0
    return row.replace(/<w:tcW w:w="\d+"/g, () => `<w:tcW w:w="${widths[c++ % widths.length]}"`)
  }
  out = out.replace(/<w:tr(?=[ >])[\s\S]*?<\/w:tr>/g, perRow)
  return out
}

// ── build ───────────────────────────────────────────────────────────────────

const src = process.argv[2]
const audit = process.argv.includes('--audit')
if (!src || !fs.existsSync(src)) {
  console.error('usage: node scripts/build-quote-template.mjs <source.docx> [--audit]')
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-tpl-'))
try {
  execFileSync('unzip', ['-q', '-o', src, '-d', tmp])
  const docPath = path.join(tmp, 'word', 'document.xml')
  const xml = fs.readFileSync(docPath, 'utf8')
  const head = xml.slice(0, xml.indexOf('<w:body>') + 8)
  const tail = xml.slice(xml.lastIndexOf('</w:body>'))
  const B = splitBlocks(xml.slice(head.length, xml.lastIndexOf('</w:body>')))

  // Locate the source blocks by their text rather than by index, so a reordered
  // or lightly edited source still builds.
  // Runs are joined with NO separator: Word splits a cell's text across runs,
  // so a separator would invent spaces that are not in the document.
  const blockText = (b) => textOf(b.xml).join('').replace(/\s+/g, ' ').trim()
  const find = (pred) => {
    const i = B.findIndex((b) => pred(blockText(b), b))
    if (i === -1) throw new Error(`could not find a required source block (${pred})`)
    return B[i].xml
  }
  const LOGO_TOP = B[0].xml
  const LOGO_BOTTOM = B[B.length - 2].xml
  const TITLE = find((t) => t === 'MIRA VISTA')
  const SUBTITLE = find((t) => t.startsWith('PREFAB STEEL FRAMING'))
  const INFO = find((t) => t.startsWith('PROJECTQUOTE INFORMATION'))
  const GREEN = find((t) => t.startsWith('BUILD FASTER'))
  const AMBER = find((t) => t.startsWith('BER WILSON TURNKEY QUOTE'))
  const RED = find((t) => t.startsWith('PANEL DELIVERY'))
  const PRICE = find((t) => t.startsWith('ScopeAreaRateAmount'))
  const HEADING = find((t) => t === 'Quote Price')
  const BULLET = find((t) => t.startsWith('Builder'))
  const SCHEDULE = find((t) => t.startsWith('MeasureBer Wilson prefab'))
  const RED2 = find((t) => t.startsWith('SCHEDULE BASIS'))
  const GRID3 = find((t) => t.startsWith('Ber Wilson installation milestone'))
  const GRID2 = find((t) => t.startsWith('CLIENT ACCEPTANCE'))
  const BODYP = find((t) => t.startsWith('The prices below separate'))
  const PAGEBREAK = B.find((b) => b.xml.includes('w:type="page"')).xml
  const SPACERP = B.find((b, i) => b.tag === 'w:p' && textOf(b.xml).join('') === '' && i > 3).xml

  if (audit) {
    for (const [name, blk] of Object.entries({ INFO, PRICE, GRID3, GRID2, SCHEDULE })) {
      const rows = rowsOf(blk)
      const perRow = rows.map((r) => textOf(r).length)
      console.log(`${name}: ${rows.length} rows, runs per row ${perRow.join('/')}`)
    }
    process.exit(0)
  }

  const heading = (text) => retext(HEADING, [text])
  const bullet = (text) => retext(BULLET, [text])
  const para = (text) => retext(BODYP, [text])
  const callout = (base, title, body) => retext(base, [title, body])

  const out = []
  const push = (...xs) => out.push(...xs)

  // ── Page 1 — who, what, and the two numbers that matter ──────────────────
  push(LOGO_TOP, TITLE.replace('MIRA VISTA', '{{PROJECT_NAME}}'))
  push(retext(SUBTITLE, ['{{QUOTE_KIND_UPPER}} PREFAB STEEL FRAMING QUOTE']))
  push(
    setRows(INFO, [
      ['PROJECT', 'QUOTE INFORMATION'],
      ['Location', '{{SITE_ADDRESS}}'],
      ['Owner', '{{OWNER}}'],
      ['Building', '{{BUILDING_SUMMARY}}'],
      ['Conversion', '{{SCOPE_SUMMARY}}'],
      ['Estimator', '{{ESTIMATOR_NAME}}'],
      ['Contact', '{{CONTACT_LINE}}'],
      ['Quote number', '{{QUOTE_NUMBER}}'],
      ['Quote date', '{{QUOTE_DATE}}'],
      ['Valid through', '{{VALID_UNTIL}}'],
    ])
  )
  push(callout(GREEN, 'TOTAL {{QUOTE_KIND_UPPER}} CONTRACT AMOUNT DUE', '{{TOTAL_AMOUNT}}'))
  push(
    callout(
      AMBER,
      'AMOUNT DUE AT CONTRACT EXECUTION',
      '{{DUE_AT_SIGNING}} — includes {{EXECUTION_CALC}}. Payment is required before material fabrication and release.'
    )
  )
  push(
    callout(
      RED,
      '{{QUOTE_KIND_UPPER}} DELIVERY',
      'Engineering conversion, MEP channeling, complete prefab steel panels and framing materials, ' +
        // The whole tail after "Simpson connectors" is the token, because
        // "builder's risk are included" is what you get if only the
        // installation clause is conditional.
        'insulation within panels, Simpson connectors{{TURNKEY_INCLUDES_INSTALL}} are included.'
    )
  )
  push(PAGEBREAK)

  // ── Page 2 — price, then exactly what is owed and when ───────────────────
  push(heading('{{QUOTE_KIND}} Price'))
  push(
    setRows(
      PRICE,
      [
        ['{{QUOTE_KIND}} scope', 'Area', 'Rate', 'Amount'],
        ['{{KIT_SCOPE}}', '{{SF}}', '{{KIT_RATE}}', '{{KIT_AMOUNT}}'],
        ['{{INSTALL_SCOPE}}', '{{SF}}', '{{INSTALL_RATE}}', '{{INSTALL_AMOUNT}}'],
        ['TOTAL {{QUOTE_KIND_UPPER}} CONTRACT AMOUNT', '{{SF}}', '{{TOTAL_RATE}}', '{{TOTAL_AMOUNT}}'],
      ],
      { totalRow: true }
    )
  )

  // The schedule of payments only exists when there is installation to stage.
  push(heading('{{IF_INSTALL}}Amounts Due'))
  push(
    setRows(
      setWidths(GRID3, [4600, 3200, 2100]),
      [
        ['Payment event', 'Calculation', 'Amount due'],
        ['Contract execution and material release', '{{EXECUTION_CALC}}', '{{DUE_AT_SIGNING}}'],
        ['50% framing completion', '25% of installation', '{{MILESTONE_1_AMOUNT}}'],
        ['90% framing completion', '20% of installation', '{{MILESTONE_2_AMOUNT}}'],
        ['Successful completion and framing inspection', '5% of installation', '{{MILESTONE_3_AMOUNT}}'],
        ['TOTAL PAYMENTS DUE', '100% of {{QUOTE_KIND_LOWER}} contract', '{{TOTAL_AMOUNT}}'],
      ],
      { totalRow: true }
    )
  )
  push(
    callout(
      AMBER,
      'PAYMENT REQUIREMENT',
      'The full {{QUOTE_KIND_LOWER}} contract amount is {{TOTAL_AMOUNT}}. The initial amount due is ' +
        '{{DUE_AT_SIGNING}}. The remaining {{REMAINING_PAYMENTS}} is paid through the three listed ' +
        'progress milestones.{{END_INSTALL}}'
    )
  )

  push(heading('Included {{QUOTE_KIND}} Scope'))
  for (const b of [
    'Engineering conversion of the existing wood-framed plans into an engineered cold-formed steel prefab panel system.',
    'Panel engineering, framing layouts, fabrication drawings, connection details, and coordinated panel schedules.',
    'MEP engineering and channeling integrated into the panels, including service chases, pathways, prepunched holes, sleeves, openings, inserts, and penetrations.',
    'Concrete-to-steel coordination for embeds, anchors, hold-downs, bearing points, and panel connections.',
    'Complete wall, floor, and roof prefab panel material package, including tracks, clips, bridging, blocking, bracing, fasteners, and accessories.',
    'Insulation within prefab panel assemblies and Simpson Strong-Tie branded hold-downs, straps, anchors, fasteners, and connectors.',
    "Builder's risk included.",
  ]) push(bullet(b))
  push(
    bullet(
      '{{IF_INSTALL}}Ber Wilson installation, including lifts, telehandlers, rigging, material handling, ' +
        'crane, operator, panel hoisting, assembly, bracing, fastening, and erection.{{END_INSTALL}}'
    )
  )
  push(PAGEBREAK)

  // ── Page 3 — how the panels arrive, what is not ours, alternatives ───────
  push(heading('Panels and Schedule'))
  push(
    callout(
      RED,
      'PANEL DELIVERY',
      'Wall, floor, and roof framing will be fabricated and delivered as labeled, sequenced panels or ' +
        'panelized assemblies according to the approved fabrication package.'
    )
  )
  push(
    setRows(SCHEDULE, [
      ['{{IF_INSTALL}}Measure', 'Ber Wilson prefab installation', 'Standard wood framing'],
      ['Field framing duration', '4–6 weeks anticipated', 'Approximately 4 months'],
      ['Projected advantage', 'Approximately 2.5–3 months faster', 'Baseline'],
      ['MEP field time', '40%–50% projected reduction', 'Field layout/cutting baseline'],
      ['Site work', 'Panel setting and connections', 'Field measuring, cutting, and assembly'],
    ])
  )
  push(
    callout(
      RED2,
      'SCHEDULE BASIS',
      'The 4–6 week timeframe assumes approved drawings, timely material payment and release, complete ' +
        'concrete work, clear crane access, sequenced deliveries, timely inspections, and uninterrupted ' +
        'work areas.{{END_INSTALL}}'
    )
  )

  push(heading('Exclusions'))
  for (const b of [
    'MEP equipment, ductwork, piping, conduit, wiring, controls, rough-in, installation, testing, balancing, and commissioning. MEP engineering and panel channeling are included; MEP construction is excluded.',
    'Concrete materials, reinforcement, formwork, placement, finishing, foundations, slabs, walls, and concrete labor. Concrete interface coordination is included.',
    'Exterior cladding and finishes, including siding, masonry veneer, stucco, exterior metal panels, rainscreen, trim, flashings, and coatings.',
    'Drywall, gypsum board, finishing, texture, painting, and interior finishes. These may be quoted separately.',
    'Roofing, waterproofing, weather-resistive barriers, glazing, windows, doors, storefront, sealants, and firestopping unless specifically listed.',
    'Sitework, demolition, excavation, utilities, paving, landscaping, stairs, rails, canopies, finish carpentry, and structural steel outside the prefab package.',
    'Insulation outside the prefab panels, permits, fees, taxes, bonds, testing, special inspections, extraordinary crane access, and abnormal site conditions.',
  ]) push(bullet(b))

  push(heading('Alternative Delivery'))
  push(
    para(
      'Materials plus Owner-crew training is TBQ and is not part of this {{QUOTE_KIND_LOWER}} contract amount. ' +
        'A wood-frame alternate may also be quoted upon request.'
    )
  )
  push(PAGEBREAK)

  // ── Page 4 — what is being signed for, and what is owed on signing ───────
  push(heading('Acceptance and Payment Authorization'))
  push(callout(GREEN, '{{QUOTE_KIND_UPPER}} CONTRACT AMOUNT DUE', '{{TOTAL_AMOUNT}}'))
  push(callout(AMBER, 'DUE UPON SIGNING', '{{DUE_AT_SIGNING}}'))
  push(
    setRows(
      shadeRow(setWidths(GRID2, [7900, 2000]), 5, 'EAF2ED'),
      [
        ['PAYMENT SUMMARY', 'AMOUNT'],
        ['Prefab panel materials — 100% due upon signing', '{{KIT_AMOUNT}}'],
        ['{{ROW_IF_INSTALL}}Installation mobilization — 50% due upon signing', '{{INSTALL_MOBILIZATION}}'],
        ['TOTAL DUE UPON SIGNING', '{{DUE_AT_SIGNING}}'],
        ['{{ROW_IF_INSTALL}}Remaining progress payments', '{{REMAINING_PAYMENTS}}'],
        ['TOTAL {{QUOTE_KIND_UPPER}} CONTRACT', '{{TOTAL_AMOUNT}}'],
      ],
      { totalRow: true }
    )
  )
  push(
    para(
      'By signing below, Client accepts the {{QUOTE_KIND_LOWER}} scope, total contract amount, exclusions, ' +
        'schedule assumptions, and payment obligations stated in this quote.'
    )
  )
  push(
    setRows(GRID2, [
      ['CLIENT ACCEPTANCE', 'BER WILSON'],
      ['Company: {{CLIENT_COMPANY}}', 'Estimator: {{ESTIMATOR_NAME}}'],
      ['Name: ______________________________', 'Email: {{ESTIMATOR_EMAIL}}'],
      ['Title: _______________________________', 'Phone: {{ESTIMATOR_PHONE}}'],
      ['Signature: ___________________________', 'Signature: ___________________________'],
      ['Date: _______________________________', 'Date: _______________________________'],
    ])
  )
  push(LOGO_BOTTOM)
  push(B[B.length - 1].xml) // sectPr

  // Google merges tables that touch, so separate every adjacent pair — with the
  // source document's OWN empty paragraph, which carries its spacing, rather
  // than a hairline that leaves the callouts crammed against each other.
  const spaced = []
  for (const blk of out.filter(Boolean)) {
    const prev = spaced[spaced.length - 1]
    if (prev && prev.trimEnd().endsWith('</w:tbl>') && blk.startsWith('<w:tbl')) spaced.push(SPACERP)
    spaced.push(blk)
  }
  const body = spaced.join('')
  if (/<\/w:tbl>\s*<w:tbl>/.test(body)) {
    console.error('adjacent tables in the output — Google would merge them')
    process.exit(1)
  }
  fs.writeFileSync(docPath, head + body + tail)

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  if (fs.existsSync(OUT)) fs.rmSync(OUT)
  execFileSync('zip', ['-q', '-r', '-X', OUT, '.'], { cwd: tmp })

  const tokens = new Set([...body.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]))
  console.log(`blocks written:  ${out.filter(Boolean).length}`)
  console.log(`tokens placed:   ${[...tokens].sort().join(', ')}`)
  console.log(`wrote:           ${OUT} (${fs.statSync(OUT).size} bytes)`)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
