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
import type { SeedTarget } from '@/lib/email-ingestion/analyze-meeting'

/** Match names case-insensitively but EXACTLY — see resolveMeetingTarget. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`)
}

/**
 * Resolve a meeting-title segment to exactly one project or opportunity.
 *
 * The bar is an EXACT name match, case-insensitive, and a single hit across both
 * tables. That is deliberately stricter than the trigram matcher the review
 * screen uses, because this decides an automatic action: §12 — ambiguity must
 * mean NO match, and one hit on a weak key is an unchallenged match, not a
 * unique one. A title segment is a label a person typed, so exact is the right
 * bar; anything softer belongs in front of the reviewer, which is where it goes.
 *
 * Candidates are tried in order and the first unambiguous hit wins. Two records
 * sharing a name refuses outright rather than picking one.
 */
export async function resolveMeetingTarget(
  candidates: string[],
): Promise<{ target: SeedTarget | null; ambiguous: string | null }> {
  const supabase = createAdminClient()

  for (const name of candidates) {
    const needle = escapeLike(name.trim())
    if (needle.length < 3) continue // "JV", "Q3" — too thin to act on

    const [projects, opportunities] = await Promise.all([
      supabase.from('projects').select('id, name').ilike('name', needle).limit(5),
      supabase.from('opportunities').select('id, name').ilike('name', needle).limit(5),
    ])

    const hits: SeedTarget[] = [
      ...(projects.data ?? []).map((r) => ({ kind: 'project' as const, id: r.id, name: r.name })),
      ...(opportunities.data ?? []).map((r) => ({
        kind: 'opportunity' as const,
        id: r.id,
        name: r.name,
      })),
    ]

    if (hits.length === 1) return { target: hits[0], ambiguous: null }
    if (hits.length > 1) {
      // Say WHICH records collided. "Could not file" with no reason is the kind
      // of silence that let the folder-name bug survive 192 runs.
      return {
        target: null,
        ambiguous: `"${name}" matches ${hits.length} records (${hits
          .map((h) => `${h.name} [${h.kind}]`)
          .join(', ')})`,
      }
    }
  }

  return { target: null, ambiguous: null }
}

export interface FiledDocument {
  documentId: string
  alreadyFiled: boolean
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

  const { data: existing } = await supabase
    .from(table)
    .select('id')
    .eq('drive_file_id', opts.driveFileId)
    .maybeSingle()
  if (existing) return { documentId: existing.id, alreadyFiled: true }

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
      await supabase.storage.from('documents').remove([path])
      const { data: winner } = await supabase
        .from(table)
        .select('id')
        .eq('drive_file_id', opts.driveFileId)
        .maybeSingle()
      if (winner) return { documentId: winner.id, alreadyFiled: true }
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
      await embedOpportunityDocument(doc.id, opts.target.id, opts.content)
      // ⚠ embedOpportunityDocument inserts chunks but does NOT settle
      // embedding_status, and the column defaults to 'pending' — which the UI
      // renders as "Indexing…" forever for a row nothing will come back to.
      // embedDocument (the project path) settles its own.
      await supabase
        .from('opportunity_documents')
        .update({ embedding_status: 'complete' })
        .eq('id', doc.id)
    } else {
      await embedDocument(doc.id, opts.target.id, opts.content)
    }
  } catch (err) {
    console.error('[meet-import] note embed failed:', err)
    await supabase.from(table).update({ embedding_status: 'error' }).eq('id', doc.id)
  }

  return { documentId: doc.id, alreadyFiled: false }
}
