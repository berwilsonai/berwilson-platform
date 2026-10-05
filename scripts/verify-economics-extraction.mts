/**
 * Does the local model actually find a deal's economics in a real document?
 *
 *   node --no-deprecation --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/verify-economics-extraction.mts [search term]
 *
 * READ-ONLY. It takes a real document off the Studio, runs the extraction
 * prompt over the first window of it, screens the result exactly as the live
 * pass would, and PRINTS every figure with the sentence it came from plus every
 * discard with its reason. Nothing is staged and no record is touched.
 *
 * ⚠ THIS IS THE ONLY WAY TO JUDGE AN EXTRACTION. A prompt that reads well is
 * not a prompt that works, and a pass that returns three figures from a sixty
 * page proposal might be a careful model or a broken screen. The quotes say
 * which, and so do the discard reasons.
 *
 * Expect 30 to 60 seconds: this is an extraction-class task on a reasoning
 * model, and LM Studio serves one request at a time.
 */

import { callGemini } from '@/lib/ai/gemini'
import {
  buildEconomicsExtractionPrompt,
  ECONOMICS_EXTRACTION_PROMPT_VERSION,
} from '@/lib/ai/prompts/economics-extraction'
import { createAdminClient } from '@/lib/supabase/admin'
import { screenExtraction, type ExtractionPayload } from '@/lib/economics/extract'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

const term = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'GridEdge'
const WINDOW = Number(process.env.AGENT_DOC_WINDOW_CHARS) || 40_000

const db = createAdminClient()

// Opportunity documents first: the richest economics on file sits on GridEdge.
const { data: oppDocs } = await db
  .from('opportunity_documents')
  .select('file_name,extracted_text')
  .ilike('file_name', `%${term}%`)
  .not('extracted_text', 'is', null)
  .order('file_name')
  .limit(1)

let doc = (oppDocs ?? [])[0] as { file_name: string; extracted_text: string } | undefined

if (!doc) {
  const { data: projectDocs } = await db
    .from('documents')
    .select('file_name,extracted_text')
    .ilike('file_name', `%${term}%`)
    .is('superseded_at', null)
    .not('extracted_text', 'is', null)
    .limit(1)
  doc = (projectDocs ?? [])[0] as { file_name: string; extracted_text: string } | undefined
}

if (!doc) {
  console.log(`${RED}No document matching "${term}" has extracted text.${OFF}`)
  process.exit(1)
}

const text = doc.extracted_text
console.log(`${BOLD}${doc.file_name}${OFF}`)
console.log(
  `${DIM}${text.length.toLocaleString('en-US')} characters. Reading the first ${Math.min(WINDOW, text.length).toLocaleString('en-US')}.${OFF}`
)
console.log(`${DIM}Prompt version ${ECONOMICS_EXTRACTION_PROMPT_VERSION}. This takes a minute.${OFF}\n`)

const started = Date.now()
const { data, model, tokensIn, tokensOut, latencyMs } = await callGemini<ExtractionPayload>({
  task: 'economics_extraction_verify',
  systemPrompt: buildEconomicsExtractionPrompt(),
  userMessage: `Document: ${doc.file_name}\n\n${text.slice(0, WINDOW)}`,
  userId: '00000000-0000-0000-0000-000000000000',
  promptVersion: ECONOMICS_EXTRACTION_PROMPT_VERSION,
})

if (typeof data !== 'object' || data == null) {
  console.log(`${RED}The model did not return JSON.${OFF}`)
  console.log(String(data).slice(0, 2000))
  process.exit(1)
}

const payload = data as ExtractionPayload
const screened = screenExtraction(payload)

console.log(
  `${DIM}${model} · ${tokensIn} in / ${tokensOut} out · ${(latencyMs / 1000).toFixed(1)}s (wall ${((Date.now() - started) / 1000).toFixed(1)}s)${OFF}\n`
)

if (payload.nothing_found === true) {
  console.log(`${YELLOW}The model reports no deal economics in this window.${OFF}`)
}

console.log(`${CYAN}Figures that would be staged (${screened.accepted.length})${OFF}`)
if (screened.accepted.length === 0) {
  console.log(`  ${DIM}none${OFF}`)
}
for (const { scope, figure } of screened.accepted) {
  console.log(
    `\n  ${BOLD}${figure.label}${OFF}  ${figure.value.toLocaleString('en-US')}${figure.unit ? ` ${figure.unit}` : ''}`
  )
  console.log(
    `  ${DIM}${scope === 'deal' ? 'deal level' : figure.lineType} · ${figure.field} · basis: ${figure.basis}${
      figure.confidence != null ? ` · confidence ${figure.confidence}` : ''
    }${figure.counterparty ? ` · ${figure.counterparty}` : ''}${OFF}`
  )
  console.log(`  ${DIM}"${figure.quote.replace(/\s+/g, ' ').slice(0, 220)}"${OFF}`)
  if (figure.reasoning) console.log(`  ${YELLOW}${figure.reasoning}${OFF}`)
}

console.log(`\n${CYAN}Discarded (${screened.discarded})${OFF}`)
const reasons = Object.entries(screened.discardedReasons)
if (reasons.length === 0) console.log(`  ${DIM}none${OFF}`)
for (const [reason, count] of reasons.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}  ${reason}`)
}

if (typeof payload.notes === 'string' && payload.notes.trim()) {
  console.log(`\n${CYAN}What the model says this document is${OFF}`)
  console.log(`  ${payload.notes.trim()}`)
}

console.log(
  `\n${DIM}Judge the figures against the quotes. A figure whose quote does not support it is the` +
    ` one thing this screen exists to catch; a careful refusal is a correct answer.${OFF}`
)
console.log(`${GREEN}Nothing was staged and no record was touched.${OFF}`)
