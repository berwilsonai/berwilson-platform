/**
 * File a document onto its deal when the document is NAMED AFTER that deal.
 *
 * ── WHY THIS IS NOT A §11 VIOLATION ──────────────────────────────────────────
 * §11 forbids mail becoming a RECORD without human review, and the 10-12
 * amendment lets Pepper UPDATE records unattended while creating nothing. This
 * pass creates nothing: every row it touches already exists as a `documents`
 * row, and all it changes is which deal the row points at. Richard's direction
 * (2026-10-29): a document whose filename or Drive folder contains a record's
 * whole name should file itself rather than wait for a click.
 *
 * ── THE BAR, AND WHY IT IS NOT THE MATCHER'S ─────────────────────────────────
 * `matchDocument` proposes on three different grounds — a solicitation number,
 * a learned identifier, a human-asserted alias, two distinctive shared words,
 * or the whole name. That set is right for OFFERING a filing to a human who
 * will look at it. It is too broad to apply unattended, and the measurement is
 * in the header of `identifiesRecord`: of the records a two-word-overlap gate
 * would have created from recordings, 9 of 9 were wrong.
 *
 * So this pass uses `identifiesRecord` — the record's whole name, contiguously,
 * once punctuation is flattened. Threshold-free, already measured against this
 * corpus, and already the bar for the one other unattended write that turns on
 * a name.
 *
 * ⚠ AN ASSERTED ALIAS IS DELIBERATELY NOT ENOUGH, WHICH IS A REVERSAL OF WHAT
 * THIS PASS WAS PLANNED TO DO. §12 says an alias is a human assertion and
 * should carry a human's standing, and `bestMatch` agrees — it returns
 * `certainty: 'linked'` for one, outranking every similarity score. Measured on
 * the live register before building, that is not safe to act on unattended:
 *
 *   `tokenize()` drops any token of two characters or fewer, so the alias
 *   **"Tensor CM"** — written to NARROW to the construction-management
 *   engagement — is stored as the single token **`tensor`**, the counterparty's
 *   own name. It then matches `Tensor MNDA (with Non-Circumvention).docx`,
 *   `Tensor IQ LLC - Bio Jonathan Houk.pdf` and every other Tensor IQ document,
 *   and files them onto one specific engagement as a FACT. This is §12's
 *   recorded Tensor failure — *one `Tensor MNDA` 'proving' four unrelated
 *   sites on the counterparty word alone* — arriving through the alias door.
 *
 *   13 of the 86 aliases on the register lose a word this way and 8 collapse to
 *   a single token. Most are harmless ("Project Riverdale" → `riverdale`, since
 *   `project` is a deliberate stopword); "Tensor CM" is not.
 *
 * Alias-grade matches therefore stay in the queue, where they already were. The
 * collapse itself is reported as an open item rather than fixed here: alias
 * tokens also drive THREAD routing across the whole corpus, so changing what
 * one means is a change with a much larger blast radius than this pass.
 *
 * ── WHAT IS NOT TOUCHED ──────────────────────────────────────────────────────
 * Documents already filed on a deal (`misfiled`). Moving one is overturning a
 * placement somebody may have made on purpose, which is a different act from
 * filing one that sits nowhere — and `filing_confirmed_at` only records the
 * confirmations a human got round to. Those keep their row in `/decide`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { findUnparentedDocuments, findMisfiledCompanyDocuments } from './unfiled'
import { refileDocument } from './refile'
import { identifiesRecord } from '@/lib/records/from-recording'
import { createAdminClient } from '@/lib/supabase/admin'
import { PEPPER_ACTOR, assertPepper } from '@/lib/provenance/db'
import type { Database } from '@/types/database'

/** One document this pass would move, with everything a report needs. */
export interface AutoFileDecision {
  documentId: string
  fileName: string
  folderPath: string | null
  target: { kind: 'project' | 'opportunity' | 'steel_deal'; id: string; name: string }
  /** Which queue it came from — the two have different costs of being left. */
  from: 'unparented' | 'company'
}

export interface AutoFileProgress {
  /** Rows whose name identified their record and were moved. */
  filed: AutoFileDecision[]
  /** Proposed by the matcher but not at this bar — still waiting on a human. */
  heldForHuman: number
  failed: { documentId: string; fileName: string; error: string }[]
}

/**
 * The name a document is judged on.
 *
 * ⚠ THE FOLDER PATH IS PART OF IT, AND IS THE STRONGER HALF. §12: a container a
 * human filed into is an ASSERTION, not a description — "Business Plan.docx"
 * inside "Corporate /M & A/GridEdge Modular Datacenter" names its deal exactly
 * once, in the folder. `documentName()` in match.ts composes the same two
 * fields for the same reason; this mirrors it rather than importing it, because
 * the queue hands back a `CompanyKnowledgeDoc` and not the raw row.
 */
function judgedName(d: {
  fileName: string
  folderPath: string | null
  docType: string | null
}): string {
  const stem = d.fileName.replace(/\.[a-z0-9]{1,5}$/i, '')
  return [stem, d.folderPath ?? '', d.docType ?? ''].filter(Boolean).join(' ')
}

/**
 * Which of the queued documents name their own record outright.
 *
 * Pure, so the decision can be tested and dry-run without a database.
 */
export function planAutoFile(
  docs: {
    id: string
    fileName: string
    folderPath: string | null
    docType: string | null
    target: { kind: 'project' | 'opportunity' | 'steel_deal'; id: string; name: string } | null
  }[],
  from: AutoFileDecision['from']
): { file: AutoFileDecision[]; held: number } {
  const file: AutoFileDecision[] = []
  let held = 0
  for (const d of docs) {
    // A row with no proposal is not a candidate at all — it is not "held", it
    // was never offered. Counting it would inflate the held number into
    // something that does not mean what the report says it means.
    if (!d.target) continue
    if (identifiesRecord(judgedName(d), d.target.name)) {
      file.push({
        documentId: d.id,
        fileName: d.fileName,
        folderPath: d.folderPath,
        target: d.target,
        from,
      })
    } else {
      held++
    }
  }
  return { file, held }
}

/**
 * File every queued document that names its own record.
 *
 * `dryRun` returns exactly what it would do and writes nothing — the mode the
 * bar was measured in, and the one to re-run after changing anything here.
 */
export async function autoFileDocuments(
  opts: { dryRun?: boolean; supabase?: SupabaseClient<Database> } = {}
): Promise<AutoFileProgress> {
  const { dryRun = false } = opts
  const progress: AutoFileProgress = { filed: [], heldForHuman: 0, failed: [] }

  const [unparented, company] = await Promise.all([
    findUnparentedDocuments(),
    findMisfiledCompanyDocuments(),
  ])

  const plans = [
    planAutoFile(unparented.offered, 'unparented'),
    planAutoFile(company, 'company'),
  ]
  progress.heldForHuman = plans.reduce((n, p) => n + p.held, 0)
  const decisions = plans.flatMap((p) => p.file)

  if (dryRun) {
    progress.filed = decisions
    return progress
  }

  /*
    ⚠ AS PEPPER, NOT AS "system". §11's 10-12 amendment trades the approval gate
    for attribution: every unattended write carries her actor and is reported.
    `documents` is a tracked table, so a filing done on the plain admin client
    would appear in the append-only log as `system` — and a trail whose every
    row reads "system" answers nothing, which is the only question it was added
    to answer (§12).

    `assertPepper()` first, for the reason its own header gives: resolving the
    seat at runtime means silently falling back to an unattributed write the day
    somebody renames it, and that is the one thing this design cannot tolerate.
  */
  await assertPepper()
  const supabase = opts.supabase ?? createAdminClient(PEPPER_ACTOR)

  for (const d of decisions) {
    try {
      // ⚠ BOTH QUEUES READ `documents`, SO THE DEFAULT SOURCE IS RIGHT HERE.
      // An opportunity's own documents live in `opportunity_documents` and are
      // reached only by the `misfiled` pass, which this deliberately does not
      // touch. If that ever changes, the source must travel with the row —
      // sending the default for one of those is a refused request.
      await refileDocument(supabase, d.documentId, d.target, 'documents')
      progress.filed.push(d)
    } catch (err) {
      progress.failed.push({
        documentId: d.documentId,
        fileName: d.fileName,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return progress
}
