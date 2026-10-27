/**
 * Turn a pasted plain-text document back into blocks.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * `company_profile.about` holds a real document — Richard pasted the company
 * briefing into it — and the page rendered the whole thing as ONE
 * `<p className="whitespace-pre-line">`. Measured 2026-10-27: **14,579
 * characters over 156 lines**, including eighty-underscore horizontal rules,
 * three presidential quotes with attributions, bulleted figure lists and
 * eight section headings, all at 14.5px in a single undifferentiated run. The
 * UI audit called it "the single most unfinished-looking thing in the app",
 * and it was not a styling problem: the structure was in the text the whole
 * time and nothing read it.
 *
 * ⚠ THE RULES BELOW WERE MEASURED AGAINST THAT CORPUS, NOT CHOSEN (§12). Each
 * one is listed with the lines it has to catch and the lines it must not:
 *
 *   rule        ≥8 repeated _ ─ – - or = and nothing else.
 *               catches the 80-underscore separators.
 *   bullet      starts `•`, `●`, `*` or `- `. Consecutive ones become a list.
 *               catches "• $1.6 trillion target in global construction…"
 *   attribution starts an em/en dash AND the previous line was a quote.
 *               catches "— President Ronald Reagan"; leaves a dash-led
 *               sentence mid-document alone.
 *   quote       the whole line is wrapped in " or ".
 *   heading     ≤5 words, ≤50 chars, no `|`, no `:`, no terminal `.`.
 *               ⚠ THE WORD LIMIT AND THE TWO PUNCTUATION TESTS ARE THE WHOLE
 *               RULE. Without them "Ericson Tua'one | Founder and CEO | South
 *               Jordan, Utah" (a byline), "Document Control: BW-BRG-2026-012"
 *               and "Three presidents. One mission. Ber Wilson is building
 *               it." all become headings — a short line is not a title, a
 *               short line with no sentence in it is.
 *   paragraph   everything else.
 *
 * ⚠ A LINE IS A PARAGRAPH; LINES ARE NEVER JOINED. The first version wrapped
 * consecutive non-blank lines into one paragraph, which is what a hard-wrapped
 * plain-text file wants — and this corpus is not one. Its paragraphs are
 * single lines of up to 190 characters, and "The Platform" is followed
 * IMMEDIATELY by the paragraph beneath it with no blank line between. Joining
 * would have merged every section's two paragraphs into one, and the test that
 * caught it was a fixture I had invented rather than taken from the corpus
 * (§12: a fixture that builds the field directly cannot catch a producer that
 * never fills it).
 *
 * Pure and tested (`prose.test.ts`) because the only honest way to change a
 * rule here is to show what it does to lines the corpus actually contains.
 */

export type ProseBlock =
  | { kind: 'rule' }
  | { kind: 'heading'; text: string }
  | { kind: 'quote'; text: string; attribution?: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'paragraph'; text: string }

const RULE = /^[\s]*[_─—–=-]{8,}[\s]*$/
const BULLET = /^\s*[•●*]\s+|^\s*-\s+/
const QUOTE = /^\s*["“](.+)["”]\s*$/
const ATTRIBUTION = /^\s*[—–]\s*(.+)$/

/**
 * ≤5 words, ≤50 chars, no pipe, no colon, no sentence-ending full stop, and
 * not dash-led.
 *
 * ⚠ THE DASH TEST IS NOT DECORATION. A second attribution under an already
 * attributed quote falls through the attribution rule, and "— Two" is two
 * short words with no terminal stop — so without this it became a HEADING.
 * A heading never opens with an em dash; a stray attribution is prose.
 */
function isHeading(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 50) return false
  if (/^[\u2014\u2013-]/.test(t)) return false
  if (t.includes('|') || t.includes(':')) return false
  if (/[.!?]$/.test(t)) return false
  return t.split(/\s+/).length <= 5
}

export function parseProseBlocks(text: string): ProseBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ProseBlock[] = []
  let list: string[] = []

  const flushList = () => {
    if (!list.length) return
    blocks.push({ kind: 'list', items: list })
    list = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushList()
      continue
    }
    if (RULE.test(line)) {
      flushList()
      blocks.push({ kind: 'rule' })
      continue
    }
    if (BULLET.test(line)) {
      list.push(line.replace(BULLET, '').trim())
      continue
    }
    flushList()

    // An attribution only attaches to a quote that is already the last block
    // AND has not been attributed yet — otherwise a dash-led sentence further
    // down the document would silently become somebody's byline.
    const attr = ATTRIBUTION.exec(line)
    const last = blocks[blocks.length - 1]
    if (attr && last?.kind === 'quote' && !last.attribution) {
      last.attribution = attr[1].trim()
      continue
    }

    const quoted = QUOTE.exec(line)
    if (quoted) {
      blocks.push({ kind: 'quote', text: quoted[1].trim() })
      continue
    }

    if (isHeading(line)) {
      blocks.push({ kind: 'heading', text: line.trim() })
      continue
    }

    blocks.push({ kind: 'paragraph', text: line.trim() })
  }
  flushList()
  return blocks
}
