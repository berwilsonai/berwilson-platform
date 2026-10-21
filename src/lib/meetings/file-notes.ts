/**
 * File a Meet meeting note onto the project or opportunity it belongs to.
 *
 * Deliberately separate from the confirm step. Creating tasks, contacts and
 * records still waits for a human (§11) — but a DOCUMENT is not that kind of
 * record: it is evidence, it is reversible, and withholding it until someone
 * clicks means the transcript cannot be searched or cited in the meantime. So a
 * note whose meeting title names a record unambiguously is filed straight away,
 * while everything the AI proposed about it goes to the review queue as before.
 *
 * What is stored is the WHOLE export — recap and verbatim transcript — not the
 * recap alone. The point of having the transcript is being able to quote what
 * somebody actually said.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { storeExtractedText } from '@/lib/ai/document-text'
import { embedDocument, embedOpportunityDocument } from '@/lib/ai/embeddings'
import { matchLearnedMeetingTitle } from '@/lib/email-sweep/identifiers'
import { resolveRecordByName } from '@/lib/records/resolve'
import type { SeedTarget } from '@/lib/email-ingestion/analyze-meeting'

export interface MeetingTargetResolution {
  /**
   * Strong enough to FILE the transcript onto automatically: an exact record
   * name, or a title a human has filed before.
   */
  target: SeedTarget | null
  /**
   * Good enough to PRE-TICK in the review screen and never to file on. The
   * distinction is the whole design — see resolveMeetingTarget.
   */
  suggestion: SeedTarget | null
  /** Why nothing was chosen, when that is worth saying out loud. */
  ambiguous: string | null
  /**
   * Which key decided, so the import log can be believed rather than guessed at.
   *
   * ⚠ KEEP THIS IN STEP WITH `RecordResolution['via']` in
   * src/lib/records/resolve.ts — this type is the superset (it adds the
   * learned-title bar, which is a meetings-only key) and `tsc` is what enforces
   * it: adding `alias` there failed the build HERE until this line named it,
   * which is the drift guard working rather than a chore.
   */
  via: 'learned_title' | 'exact_name' | 'alias' | 'suggested' | null
}

/**
 * Resolve a meeting-title segment to a project or opportunity.
 *
 * Three bars, and the gap between them is deliberate — a FILING is an automatic
 * action and a PRE-TICK is a suggestion a human confirms, so they cannot share
 * one threshold:
 *
 *   1. A LEARNED TITLE — this exact title was filed onto this record by a person
 *      before. Strongest key available, because it is not a guess at all: it is
 *      somebody's past decision, replayed. This is what makes a recurring call
 *      file itself from its second occurrence onward.
 *   2. An EXACT record name, case-insensitive, unique across both tables. A
 *      title segment is a label a person typed, so exact is the right bar.
 *   3. A SHARED IDENTITY-BEARING WORD — suggestion only. ⚠ A score threshold
 *      cannot do this job and that was measured, not assumed: "Eagle Mountain
 *      Development" matched Myton Development at 0.487 (wrong) while "Delta,
 *      Utah Campus" matched Delta Industrial Campus at 0.390 (right). The wrong
 *      match scores higher, because the only thing it shares is the word every
 *      fourth project here contains. WHICH word matched is the real signal — and
 *      even that is not enough to file on, because a transcript filed onto the
 *      wrong deal answers questions about that deal until somebody notices.
 *
 * Ambiguity at any bar refuses rather than picking (§12), and the refusal says
 * which records collided.
 */
export async function resolveMeetingTarget(
  candidates: string[]
): Promise<MeetingTargetResolution> {
  const supabase = createAdminClient()
  const none: MeetingTargetResolution = {
    target: null,
    suggestion: null,
    ambiguous: null,
    via: null,
  }

  // ── 1. A title a human already filed ──────────────────────────────────────
  const learned = await matchLearnedMeetingTitle(candidates).catch(() => null)
  if (learned === 'ambiguous') {
    return {
      ...none,
      ambiguous: 'this title has been filed onto more than one record before',
    }
  }
  if (learned && (learned.kind === 'project' || learned.kind === 'opportunity')) {
    const table = learned.kind === 'project' ? 'projects' : 'opportunities'
    const { data } = await supabase
      .from(table)
      .select('id, name')
      .eq('id', learned.id)
      .maybeSingle()
    // A learned title whose record has since been deleted falls through to the
    // name bars rather than refusing — the identifier is stale, not wrong.
    if (data) {
      return {
        target: { kind: learned.kind, id: data.id, name: data.name },
        suggestion: null,
        ambiguous: null,
        via: 'learned_title',
      }
    }
  }

  // ── 2 & 3. Exact name, then a shared identity-bearing word ───────────────
  // Delegated to src/lib/records/resolve.ts. These two bars were never a
  // meetings question — the email intake path needed the same ladder and was
  // using a trigram threshold instead (§12: a shared renderer wired to one
  // surface is worse than no shared renderer). Bar 1 above stays here because a
  // LEARNED TITLE is specific to a meeting: it is a title a human filed before.
  return await resolveRecordByName(candidates)
}

/** Which shelf a transcript is sitting on. */
export type DocumentShelf =
  | 'project'
  | 'opportunity'
  | 'company'
  | 'reference'
  | 'steel_deal'
  | 'unknown'

export interface FiledDocument {
  documentId: string
  alreadyFiled: boolean
  /**
   * Where it actually is — which is not always where the caller asked for it.
   *
   * The import files every transcript immediately, on `reference` when the title
   * names no record (see meet-import), so by the time a human confirms the
   * session the document already exists somewhere. The confirm step reads this
   * to decide whether to MOVE it onto the record that has just been chosen.
   */
  shelf: DocumentShelf
  /**
   * The project or opportunity it is filed on, when the shelf is one of those.
   *
   * Worth carrying because an EXISTING FILING IS A DECISION SOMEBODY ALREADY
   * MADE, and it beats re-deriving one from the title. The backfill uses it to
   * put a meeting row on the record its own transcript is already sitting on,
   * rather than re-running a name match that is weaker than the fact in hand.
   */
  recordId: string | null
}

/** Read the shelf off a `documents` row. */
function shelfOf(row: {
  is_company?: boolean | null
  is_reference?: boolean | null
  project_id?: string | null
  steel_deal_id?: string | null
}): DocumentShelf {
  if (row.is_company) return 'company'
  if (row.is_reference) return 'reference'
  if (row.project_id) return 'project'
  if (row.steel_deal_id) return 'steel_deal'
  return 'unknown'
}

/**
 * The transcript already filed for this Drive file, wherever it lives.
 *
 * ⚠ READS BOTH TABLES, ALWAYS. `drive_file_id` carries a partial unique index on
 * `documents` AND on `opportunity_documents`, and the parallel-table split (§9)
 * means "is this already filed" is always two questions — the same trap that had
 * drive-sync re-claiming opportunity documents as company knowledge. Checking
 * only the table the CALLER asked for is worse than not checking: the insert
 * then fails on the other table's unique index, and the 23505 recovery looks in
 * the wrong place and reports the filing as impossible.
 */
export async function findFiledTranscript(
  supabase: ReturnType<typeof createAdminClient>,
  driveFileId: string
): Promise<FiledDocument | null> {
  const [docs, oppDocs] = await Promise.all([
    supabase
      .from('documents')
      .select('id, is_company, is_reference, project_id, steel_deal_id')
      .eq('drive_file_id', driveFileId)
      .maybeSingle(),
    supabase
      .from('opportunity_documents')
      .select('id, opportunity_id')
      .eq('drive_file_id', driveFileId)
      .maybeSingle(),
  ])

  if (docs.data) {
    const shelf = shelfOf(docs.data)
    return {
      documentId: docs.data.id,
      alreadyFiled: true,
      shelf,
      recordId: shelf === 'project' ? docs.data.project_id : null,
    }
  }
  if (oppDocs.data) {
    return {
      documentId: oppDocs.data.id,
      alreadyFiled: true,
      shelf: 'opportunity',
      recordId: oppDocs.data.opportunity_id,
    }
  }
  return null
}

/**
 * Where a verbatim transcript can be filed.
 *
 * Wider than {@link SeedTarget} by one arm. A call that named a dozen candidate
 * sites has no single record to sit on — every one of them was staged as a lead,
 * and a lead has no document shelf. Copying the same hour-long transcript onto
 * twelve records would be worse: the same evidence twelve times, each copy
 * claiming to be about one site.
 *
 * So the company shelf is the honest home for it. It is one verbatim copy,
 * indexed and quotable, and the per-deal reading of it lives on each lead as
 * its note.
 */
export type FileTarget =
  | SeedTarget
  | { kind: 'company'; id: 'company'; name: string }
  /**
   * A transcript with no deal behind it — a portfolio or brokerage call whose
   * sites were all staged as leads.
   *
   * Filed as REFERENCE, never as company knowledge. A company-scoped chunk is
   * presented to assessFit() as "RELEVANT BER WILSON EVIDENCE", so filing a
   * call about a dozen sites nobody chose to pursue there would have every
   * future lead scored partly against it. Reference keeps the transcript
   * searchable and quotable, which is the whole point of filing it, without
   * making it a claim about the company's capabilities.
   */
  | { kind: 'reference'; id: 'reference'; name: string }

/**
 * Store the meeting note as a document on its target and index it.
 *
 * Idempotent through `drive_file_id`, which carries a platform-wide partial
 * unique index on both tables. Partial indexes cannot be an ON CONFLICT target
 * (§12), so this checks first and treats 23505 as "a concurrent run won" rather
 * than as a failure.
 */
export async function fileMeetingDocument(opts: {
  target: FileTarget
  driveFileId: string
  title: string
  /** The whole export: recap plus verbatim transcript. */
  content: string
  /** The AI recap's summary. A NULL summary is a document the agent never opens (§12). */
  summary: string | null
  meetingDate: string | null
}): Promise<FiledDocument | null> {
  const supabase = createAdminClient()
  const table = opts.target.kind === 'opportunity' ? 'opportunity_documents' : 'documents'

  const existing = await findFiledTranscript(supabase, opts.driveFileId)
  if (existing) return existing

  const folder =
    opts.target.kind === 'opportunity'
      ? `opportunities/${opts.target.id}`
      : opts.target.kind === 'company'
        ? 'company'
        : `projects/${opts.target.id}`
  const safeTitle = opts.title.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'meeting'
  const path = `${folder}/${Date.now()}_${safeTitle}.md`

  const body = Buffer.from(opts.content, 'utf-8')
  const { error: uploadErr } = await supabase.storage
    .from('documents')
    .upload(path, body, { contentType: 'text/markdown', upsert: false })
  if (uploadErr) {
    console.error('[meet-import] note upload failed:', uploadErr.message)
    return null
  }

  const base = {
    storage_path: path,
    // Named apart from the MINUTES document the confirm step writes for the same
    // meeting (saveReportDocument, doc_type 'other'). Two files called the same
    // thing on one record read as a duplicate; "minutes" and "transcript" read as
    // what they are — the recap, and the evidence behind it.
    file_name: `${opts.title} — transcript.md`,
    file_size_bytes: body.byteLength,
    mime_type: 'text/markdown',
    // Plain text column, no CHECK constraint — verified against the live schema.
    doc_type: 'transcript',
    ai_summary: opts.summary,
    drive_file_id: opts.driveFileId,
    // Unlike saveReportDocument's callers there is no update row carrying this
    // content yet (that arrives at confirm), so this IS the indexed copy.
    embedding_status: 'pending',
  }

  const insert =
    opts.target.kind === 'opportunity'
      ? supabase
          .from('opportunity_documents')
          .insert({ ...base, opportunity_id: opts.target.id })
          .select('id')
          .single()
      : opts.target.kind === 'company'
        ? supabase
            .from('documents')
            .insert({ ...base, is_company: true, source: 'document' })
            .select('id')
            .single()
        : opts.target.kind === 'reference'
          ? supabase
              .from('documents')
              .insert({ ...base, is_reference: true, source: 'document' })
              .select('id')
              .single()
        : supabase
            .from('documents')
            .insert({ ...base, project_id: opts.target.id, source: 'document' })
            .select('id')
            .single()

  const { data: doc, error } = await insert
  if (error || !doc) {
    if (error?.code === '23505') {
      // A concurrent run filed it. Drop our orphaned upload and report the win.
      // Searched across both tables for the same reason the pre-check is —
      // the winner may have filed it on the other shelf entirely.
      await supabase.storage.from('documents').remove([path])
      const winner = await findFiledTranscript(supabase, opts.driveFileId)
      if (winner) return winner
    }
    console.error('[meet-import] note insert failed:', error?.message)
    await supabase.storage.from('documents').remove([path])
    return null
  }

  await storeExtractedText(supabase, table, doc.id, opts.content)

  // Embedding is what makes the transcript answerable. Non-fatal: the document
  // and its text are already filed either way.
  try {
    if (opts.target.kind === 'company') {
      await embedDocument(doc.id, null, opts.content, null, true)
    } else if (opts.target.kind === 'reference') {
      // isCompany=false: findable across the portfolio, not company evidence.
      await embedDocument(doc.id, null, opts.content, null, false)
    } else if (opts.target.kind === 'opportunity') {
      // embedOpportunityDocument settles embedding_status itself as of
      // 2026-10-05 (it used to leave the row 'pending' and oblige every
      // caller), so there is nothing to follow up with here.
      await embedOpportunityDocument(doc.id, opts.target.id, opts.content)
    } else {
      await embedDocument(doc.id, opts.target.id, opts.content)
    }
  } catch (err) {
    console.error('[meet-import] note embed failed:', err)
    await supabase.from(table).update({ embedding_status: 'error' }).eq('id', doc.id)
  }

  return {
    documentId: doc.id,
    alreadyFiled: false,
    shelf: opts.target.kind,
    recordId:
      opts.target.kind === 'project' || opts.target.kind === 'opportunity'
        ? opts.target.id
        : null,
  }
}
