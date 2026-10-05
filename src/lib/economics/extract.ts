/**
 * Reading a deal's documents for the figures an economics model needs.
 *
 * ⚠ IT STAGES PROPOSALS AND CREATES NOTHING. Every figure lands in
 * `economics_input_proposals` as `pending`, with the sentence it came from, for
 * a human to accept or reject. CLAUDE.md §11: no record is created without the
 * human confirm step, ever. Accepting is what writes a value and its
 * provenance.
 *
 * ⚠ THE MODEL FINDS FIGURES; CODE DOES THE ARITHMETIC AND THE COUNTING. Handed
 * a 69-row claim schedule the local model answered 62, so nothing here asks it
 * to multiply, annualize, total or convert. The prompt forbids it and
 * `sanityCheck` below drops anything that looks computed rather than quoted.
 *
 * ⚠ AND A FIGURE WITH NO QUOTE IS DISCARDED. The quote is not decoration: it
 * is how a reader checks the model in two seconds, and it is what the accepted
 * input's provenance inherits. A proposal nobody can verify is worse than no
 * proposal, because accepting it launders a guess into a sourced figure.
 */

import { callGemini } from '@/lib/ai/gemini'
import {
  buildEconomicsExtractionPrompt,
  ECONOMICS_EXTRACTION_PROMPT_VERSION,
} from '@/lib/ai/prompts/economics-extraction'
import { createAdminClient } from '@/lib/supabase/admin'
import type { RecordKind } from '@/lib/records/scope'
import { calcDbAs } from './db'
import { COLLECTIONS } from './collections'
import { REVENUE_LINE_TYPES } from './types'
import { isProvenanceStatus } from './provenance'

/**
 * Characters of a document fed to one extraction pass.
 *
 * Sized to the agent's own document window rather than the whole context: a
 * long proposal is read in slices so a 240,000-character report does not have
 * to fit in one prompt, and the local model is markedly worse at the far end of
 * a very long context than at the start of a shorter one.
 */
const WINDOW_CHARS = Number(process.env.AGENT_DOC_WINDOW_CHARS) || 40_000

/** Slices per document, so one enormous file cannot consume an entire evening. */
const MAX_WINDOWS = 4

export interface ExtractedFigure {
  field?: unknown
  line_type?: unknown
  label?: unknown
  value?: unknown
  value_low?: unknown
  value_high?: unknown
  unit?: unknown
  unit_uncertain?: unknown
  basis?: unknown
  is_ber_wilson_revenue?: unknown
  counterparty?: unknown
  quote?: unknown
  confidence?: unknown
}

export interface ExtractionPayload {
  figures?: ExtractedFigure[]
  deal_level?: ExtractedFigure[]
  notes?: unknown
  nothing_found?: unknown
}

export interface ExtractDocumentsResult {
  documentsRead: number
  documentsSkipped: number
  /** Why each was skipped, counted. An unlabelled count is not a signal. */
  skippedReasons: Record<string, number>
  proposalsCreated: number
  figuresDiscarded: number
  /** Why each figure was dropped, so a bad pass is diagnosable. */
  discardedReasons: Record<string, number>
  notes: string[]
}

function bump(counter: Record<string, number>, reason: string): void {
  counter[reason] = (counter[reason] ?? 0) + 1
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,\s%]/g, '')
    if (cleaned === '') return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const NUMERIC_LINE_FIELDS = new Set(
  Object.entries(COLLECTIONS.lines.fields)
    .filter(([, kind]) => kind === 'number' || kind === 'int')
    .map(([name]) => name)
)

const DEAL_LEVEL_FIELDS = new Set(['discount_rate_pct', 'cap_rate_pct', 'stated_total_amount'])

export interface ScreenResult {
  accepted: { scope: 'line' | 'deal'; figure: Accepted }[]
  discardedReasons: Record<string, number>
  discarded: number
}

/**
 * Screen a whole extraction payload, exported so a verification script can be
 * pointed at a real document and so the rules can be unit-tested.
 *
 * ⚠ THE DISCARD REASONS ARE PART OF THE ANSWER. A pass that returns three
 * figures from a sixty-page proposal might be a careful model or a broken
 * screen, and only the reasons tell the two apart.
 */
export function screenExtraction(payload: ExtractionPayload): ScreenResult {
  const discardedReasons: Record<string, number> = {}
  const accepted: ScreenResult['accepted'] = []
  let discarded = 0

  for (const [scope, list] of [
    ['line', payload.figures ?? []],
    ['deal', payload.deal_level ?? []],
  ] as const) {
    for (const figure of Array.isArray(list) ? list : []) {
      const result = sanityCheck(figure, scope, discardedReasons)
      if (result) accepted.push({ scope, figure: result })
      else discarded += 1
    }
  }

  return { accepted, discardedReasons, discarded }
}

export interface Accepted {
  field: string
  lineType: string | null
  label: string
  value: number
  unit: string | null
  basis: string
  quote: string
  confidence: number | null
  counterparty: string | null
  reasoning: string | null
}

/**
 * Drop anything that cannot be checked or cannot be stored.
 *
 * Deliberately strict. A proposal queue full of figures a reader has to
 * investigate is a queue they stop opening, which costs more than the figures
 * are worth.
 */
/**
 * Does this quote contain the figure it is offered as evidence for?
 *
 * Both sides are reduced to their digits, so "1.18" matches 1.18 and "$50-100K"
 * matches 50000 through its leading "50". A run must be two digits long to
 * count as a prefix match, or "see item 1" would vouch for 145.
 */
function quoteCarriesFigure(quote: string, value: number): boolean {
  const target = String(value).replace(/[^0-9]/g, '')
  if (target === '') return false
  const runs = quote.match(/[0-9][0-9.,]*/g) ?? []
  for (const run of runs) {
    const digits = run.replace(/[^0-9]/g, '')
    if (digits === '') continue
    if (digits === target) return true
    const shorter = digits.length < target.length ? digits : target
    const longer = digits.length < target.length ? target : digits
    if (shorter.length >= 2 && longer.startsWith(shorter)) return true
  }
  return false
}

function sanityCheck(
  figure: ExtractedFigure,
  scope: 'line' | 'deal',
  discarded: Record<string, number>
): Accepted | null {
  const field = typeof figure.field === 'string' ? figure.field : null
  if (!field) {
    bump(discarded, 'no field named')
    return null
  }

  const allowed = scope === 'line' ? NUMERIC_LINE_FIELDS : DEAL_LEVEL_FIELDS
  if (!allowed.has(field)) {
    // A field the engine does not have. Counted rather than silently ignored:
    // a model repeatedly naming the same missing field is a signal the engine
    // is short a line type, not that the model is wrong.
    bump(discarded, `field the engine has no column for: ${field}`)
    return null
  }

  // A range comes back as a range. Taking its midpoint here would hide that
  // nobody knows which end applies, so the low end is proposed and the quote
  // carries the span for the reader to see.
  const low = asNumber(figure.value_low)
  const high = asNumber(figure.value_high)
  const single = asNumber(figure.value)
  const value = single ?? low
  if (value == null) {
    bump(discarded, 'no readable figure')
    return null
  }

  const quote = typeof figure.quote === 'string' ? figure.quote.trim() : ''
  // ⚠ A CROSS-REFERENCE IS NOT A QUOTE, AND A SHORT FRAGMENT USUALLY IS ONE.
  // "see above", "see table 3", "as noted" and "ibid." tell a reader nothing,
  // which defeats the only thing this screen exists for.
  //
  // MEASURED AGAINST THE CORPUS, AND TWO EARLIER RULES BOTH FAILED IT. A
  // length-only floor let "see above" through at nine characters. A word-count
  // floor of five then rejected every figure a real pass actually produced:
  // run against the GridEdge customer-engagement deck, the model returned
  // "20MW System", "PUE guarantee (1.18)", "5-10-year initial term" and
  // "$50-100K assessment fee" — four correct figures whose quotes are two to
  // four words, verbatim, and perfectly checkable. A clever filter costs
  // evidence, every time.
  //
  // WHAT ACTUALLY SEPARATES THEM IS WHETHER THE QUOTE CONTAINS THE FIGURE, and
  // that is checkable rather than guessable. A quote passes if its digits match
  // the value's, or failing that if it has at least five words, which is what
  // a figure spelled out in words needs ("one million two hundred fifty
  // thousand dollars" carries no digits at all).
  const words = quote.split(/\s+/).filter(Boolean).length
  if (!quoteCarriesFigure(quote, value) && words < 5) {
    bump(discarded, 'no verbatim quote, so nobody could check it')
    return null
  }


  const basis = typeof figure.basis === 'string' && isProvenanceStatus(figure.basis)
    ? figure.basis
    : 'planning_assumption'

  const lineTypeRaw = typeof figure.line_type === 'string' ? figure.line_type : null
  const lineType =
    lineTypeRaw && (REVENUE_LINE_TYPES as readonly string[]).includes(lineTypeRaw)
      ? lineTypeRaw
      : null
  if (scope === 'line' && !lineType) {
    bump(discarded, 'no recognised line type, so it has nowhere to go')
    return null
  }

  const unitUncertain = figure.unit_uncertain === true
  const rangeNote =
    low != null && high != null && low !== high
      ? `The document gives a range: ${low.toLocaleString('en-US')} to ${high.toLocaleString('en-US')}. The low end is proposed.`
      : null
  const counterparty =
    typeof figure.counterparty === 'string' && figure.counterparty.trim()
      ? figure.counterparty.trim()
      : null
  const notOurs = figure.is_ber_wilson_revenue === false

  const reasoning = [
    unitUncertain ? 'The document does not make the unit unambiguous. Check it before accepting.' : null,
    rangeNote,
    notOurs ? `Reads as ${counterparty ?? 'a partner'}'s revenue rather than Ber Wilson's.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    field,
    lineType,
    label: typeof figure.label === 'string' && figure.label.trim() ? figure.label.trim() : field,
    value,
    unit: typeof figure.unit === 'string' && figure.unit.trim() ? figure.unit.trim() : null,
    basis,
    quote,
    confidence: asNumber(figure.confidence),
    counterparty,
    reasoning: reasoning || null,
  }
}

interface DocRow {
  id: string
  file_name: string
  extracted_text: string | null
}

async function documentsFor(kind: RecordKind, recordId: string): Promise<{
  rows: DocRow[]
  skipped: Record<string, number>
}> {
  const db = createAdminClient()
  const skipped: Record<string, number> = {}

  const query =
    kind === 'project'
      ? db
          .from('documents')
          .select('id,file_name,extracted_text')
          .eq('project_id', recordId)
          // ⚠ `superseded_at is null` or the graveyard reads as live content
          // and a retired duplicate gets extracted a second time.
          .is('superseded_at', null)
      : db
          .from('opportunity_documents')
          .select('id,file_name,extracted_text')
          .eq('opportunity_id', recordId)

  const { data, error } = await query.limit(200)
  if (error) throw new Error(`Could not list documents: ${error.message}`)

  const rows: DocRow[] = []
  for (const r of (data ?? []) as DocRow[]) {
    if (!r.extracted_text || r.extracted_text.trim().length < 200) {
      // Named, not lumped into one counter. An unlabelled count cannot tell
      // "nothing to do" from "a deck was dropped".
      bump(skipped, r.extracted_text ? 'too short to hold a figure' : 'no extracted text yet')
      continue
    }
    rows.push(r)
  }
  return { rows, skipped }
}

/**
 * Read a record's documents and stage what they say about its economics.
 *
 * Returns counts WITH their reasons: a coverage count is the only honest signal
 * for a pass whose failure mode is doing nothing, and a bare `skipped: 26` says
 * the same thing whether nothing was wrong or a deck was dropped.
 */
export async function extractEconomicsFromDocuments(
  economicsId: string,
  kind: RecordKind,
  recordId: string,
  actor: { id: string; email?: string | null },
  options: { documentIds?: string[]; userId?: string } = {}
): Promise<ExtractDocumentsResult> {
  const { rows, skipped } = await documentsFor(kind, recordId)
  const selected = options.documentIds
    ? rows.filter((r) => options.documentIds?.includes(r.id))
    : rows

  const systemPrompt = buildEconomicsExtractionPrompt()
  const db = calcDbAs(actor)
  const result: ExtractDocumentsResult = {
    documentsRead: 0,
    documentsSkipped: Object.values(skipped).reduce((a, b) => a + b, 0),
    skippedReasons: skipped,
    proposalsCreated: 0,
    figuresDiscarded: 0,
    discardedReasons: {},
    notes: [],
  }

  for (const doc of selected) {
    const text = doc.extracted_text ?? ''
    const windows = Math.min(MAX_WINDOWS, Math.ceil(text.length / WINDOW_CHARS))
    result.documentsRead += 1

    for (let w = 0; w < windows; w += 1) {
      const slice = text.slice(w * WINDOW_CHARS, (w + 1) * WINDOW_CHARS)
      let payload: ExtractionPayload
      try {
        const { data } = await callGemini<ExtractionPayload>({
          task: 'economics_extraction',
          systemPrompt,
          userMessage: `Document: ${doc.file_name}${windows > 1 ? ` (part ${w + 1} of ${windows})` : ''}\n\n${slice}`,
          userId: options.userId ?? actor.id,
          promptVersion: ECONOMICS_EXTRACTION_PROMPT_VERSION,
          // `jsonMode` defaults true, and callGemini pins JUDGEMENT_TEMPERATURE
          // for a structured answer on both the Gemini and local paths. That is
          // what this call needs: at the server default (~0.8) re-running the
          // same fit assessment over the same eight leads changed five of the
          // eight verdicts, and an extraction that differs each time it is asked
          // cannot be reviewed.
        })
        payload = typeof data === 'object' && data != null ? data : {}
      } catch (error) {
        // One unreadable slice must not cost the rest of the document, and the
        // failure is reported rather than read as "this document says nothing".
        const message = error instanceof Error ? error.message : String(error)
        result.notes.push(`${doc.file_name}: a pass failed (${message})`)
        continue
      }

      if (typeof payload.notes === 'string' && payload.notes.trim()) {
        result.notes.push(`${doc.file_name}: ${payload.notes.trim()}`)
      }

      const pending: Record<string, unknown>[] = []
      for (const [scope, list] of [
        ['line', payload.figures ?? []],
        ['deal', payload.deal_level ?? []],
      ] as const) {
        for (const figure of Array.isArray(list) ? list : []) {
          const accepted = sanityCheck(figure, scope, result.discardedReasons)
          if (!accepted) {
            result.figuresDiscarded += 1
            continue
          }
          pending.push({
            economics_id: economicsId,
            line_id: null,
            field_key: accepted.field,
            proposed_value: accepted.value,
            proposed_unit: accepted.unit,
            proposed_line_type: accepted.lineType,
            proposed_label: accepted.label,
            source_document_id: doc.id,
            source_quote: accepted.quote,
            confidence: accepted.confidence,
            reasoning: [
              `Basis: ${accepted.basis.replace(/_/g, ' ')}.`,
              accepted.reasoning,
              `From ${doc.file_name}.`,
            ]
              .filter(Boolean)
              .join(' '),
            status: 'pending',
            decided_by: null,
            decided_at: null,
          })
        }
      }

      if (pending.length > 0) {
        const { error } = await db.from('economics_input_proposals').insert(pending)
        if (error) {
          result.notes.push(`${doc.file_name}: ${pending.length} figures could not be staged (${error.message})`)
          continue
        }
        result.proposalsCreated += pending.length
      }
    }
  }

  return result
}
