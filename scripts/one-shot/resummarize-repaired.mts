/**
 * Re-read the 23 text threads the tapback repair put back to `pending`.
 *
 * Runs the two phases that depend on the corrected text and nothing else:
 * summarize, then commitments. Routing is deliberately left alone — a duplicate
 * paragraph never changed which deal a thread is about.
 */
import { summarizePending } from '@/lib/email-sweep/summarize-phase'
import { extractCommitments } from '@/lib/commitments/extract-phase'

const BUDGET = 40 * 60_000

console.log('summarize…')
console.log(await summarizePending({ budgetMs: BUDGET }))
console.log('commitments…')
console.log(await extractCommitments({ budgetMs: BUDGET }))
