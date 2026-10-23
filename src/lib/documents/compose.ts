/**
 * "MAKE ME A DOCUMENT" — the agent's answer, finished.
 *
 * Measured 2026-10-22 over every question ever put to Ber AI: 78 asks, and 20
 * of them want a deliverable rather than an answer. The GridEdge offer was
 * asked six times across three days, the same "review the documents on this
 * project and tell me everything I need to know" four times, and two turns say
 * it outright — "you aren't finishing the task". Each of those ended with prose
 * in a chat dock and a human copy-pasting it into Google Docs, which is the
 * data entry this platform exists to remove.
 *
 * ⚠ ONE PASS WITH A TARGET PARAMETER, NEVER A COPY PER KIND OR PER PARENT. §12
 * — the one forked copy of `runDocumentAiPass` silently discarded 413,000
 * characters, and the hardest fork to see is two sibling modules written days
 * apart. A project and an opportunity differ here in exactly two facts: which
 * table holds the record, and which table holds its documents.
 *
 * THE DIVISION OF LABOUR, which is the whole safety model:
 *   the model   writes the prose
 *   the platform supplies every figure, and refuses any the model invents
 *   a human     reads it before it has any effect
 * Nothing here creates a record, changes a field, or sends anything to a
 * counterparty. The output is a draft on a record and a text to the person who
 * asked for it.
 */

import { createHash } from 'node:crypto'

import { callGemini } from '@/lib/ai/gemini'
import { getCompanyContext } from '@/lib/ai/company-context'
import { gatherEvidence, type RecordKind } from '@/lib/curator/evidence'
import { createDocFromBytes } from '@/lib/integrations/google-drive-write'
import { exportDocAsPdf } from '@/lib/integrations/google-docs'
import { PRIMARY_MAILBOX, isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { recordDriveFolder } from '@/lib/drive/publish'
import { notify } from '@/lib/notify'
import { isConfidentialProject } from '@/lib/security/confidential'
import { createAdminClient } from '@/lib/supabase/admin'
import { pipelineValue } from '@/lib/records/pipeline-value'
import type { JsonIn } from '@/lib/supabase/types'

import { COUNSEL_NOTICE, composeKind, composeKindMenu } from './compose-kinds'
import {
  collectAllowedFigures,
  figureBlock,
  unsourcedFigures,
  unsourcedMessage,
  type PlatformFigure,
} from './figures'
import {
  bodyWithoutTitle,
  markdownToHtml,
  markdownToPlainText,
  titleFromMarkdown,
} from './markdown'

export class ComposeError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ComposeError'
    this.status = status
  }
}

export interface ComposeTarget {
  kind: RecordKind
  id: string
}

export interface ComposeResult {
  requestId: string
  status: 'ready' | 'failed'
  title: string | null
  /** The filed row, in `documents` or `opportunity_documents`. */
  documentId: string | null
  driveFileUrl: string | null
  /** True when the record is protected, so nothing left the box. */
  contained: boolean
  texted: boolean
  error: string | null
  /** Evidence items the budget dropped, so a thin document is explicable. */
  evidenceTruncated: number
}

/**
 * How long a 'composing' row may sit before a reader calls it abandoned.
 *
 * ⚠ LIVENESS IS A CLOCK, NOT THE COLUMN (§12). A `launchctl kickstart` — and a
 * deploy IS a kickstart — kills the pass before it can write either verdict, so
 * `status = 'composing'` is immortal on its own. Sized above the measured p90
 * Ber AI answer (455s) with room for the Drive round trip.
 */
export const COMPOSE_STALE_MS = Number(process.env.COMPOSE_STALE_MS ?? 900_000)

/** Characters of the model's own output fed to the guard and stored. */
const MAX_BODY_CHARS = 60_000

interface RecordRow {
  id: string
  name: string | null
  description: string | null
  location: string | null
  sector: string | null
  status: string | null
  estimated_value: number | string | null
  confidential?: boolean | null
  counterparty?: string | null
  stage?: string | null
}

const TABLES: Record<RecordKind, { record: 'projects' | 'opportunities'; docs: 'documents' | 'opportunity_documents'; parentCol: 'project_id' | 'opportunity_id' }> = {
  project: { record: 'projects', docs: 'documents', parentCol: 'project_id' },
  opportunity: { record: 'opportunities', docs: 'opportunity_documents', parentCol: 'opportunity_id' },
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9 ._-]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120)
}

/**
 * The figures the model is allowed to use, each carrying its own definition.
 *
 * ⚠ `pipelineValue()` RATHER THAN A COLUMN, because the figure has to reach the
 * model with its definition attached: §12, a money figure must carry its SHAPE.
 *
 * ⚠ AND THIS LIST IS NEARLY ALWAYS EMPTY, WHICH IS THE HONEST STATE. It used to
 * read `economics_capture_value` as well, and that column was NULL on all 30
 * records before being dropped with the calculator on 2026-10-23; one project
 * carries an `estimated_value`. So for 29 of 30 deals the model is handed no
 * money at all — and `figureBlock` tells it to write [TO BE AGREED] rather than
 * estimate, which is exactly what the figure guard exists to enforce.
 */
function platformFigures(record: RecordRow): PlatformFigure[] {
  const figures: PlatformFigure[] = []
  const value = pipelineValue(record)
  if (value.amount != null) {
    figures.push({
      label: value.definition,
      amount: value.amount,
      kind: 'money',
      definition: value.hint,
    })
  }
  return figures
}

function systemPrompt(kindKey: string, companyText: string | null): string {
  const spec = composeKind(kindKey)
  if (!spec) throw new ComposeError(`Unknown document kind: ${kindKey}`, 400)

  return [
    'You are the EVP/COO of Ber Wilson, a vertically integrated construction,',
    'development and prefab steel manufacturing company, writing a document that',
    'will be read by a person and may be sent outside the company.',
    '',
    `WHAT YOU ARE WRITING: ${spec.label}. ${spec.guidance}`,
    '',
    'HOW TO WRITE IT',
    '- Start with a single line: "# " followed by the document title. Nothing before it.',
    '- Then the document itself in Markdown: ## headings, bullet lists, short paragraphs.',
    '- Write as the company, in plain executive English. No preamble, no',
    '  restating the request, no sign-off about being an AI.',
    '- Every claim must come from the records below. Where they do not settle',
    '  something, write the item and mark it [TO BE AGREED]. A named gap is useful;',
    '  a filled-in gap is a liability.',
    '',
    '⚠ FIGURES. You may use ONLY the figures listed under FIGURES ON FILE, figures',
    'quoted verbatim in the records below, and figures given in the instruction.',
    'Do not add, total, annualise, convert or estimate any number — arithmetic is',
    'done elsewhere and a figure you compute will be rejected and the document',
    'thrown away. If a total is needed and not on file, write [TO BE AGREED].',
    '',
    spec.legal === 'needs_counsel'
      ? `⚠ THIS DOCUMENT GOES TO COUNSEL BEFORE IT GOES TO A COUNTERPARTY. End it with exactly this line on its own: ${COUNSEL_NOTICE}`
      : '',
    '',
    companyText ? `ABOUT BER WILSON\n${companyText}` : '',
    '',
    'The kinds of document this system writes, for your awareness only — do not',
    `switch kinds:\n${composeKindMenu()}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function userMessage(args: {
  record: RecordRow
  kindLabel: string
  instructions: string
  figures: PlatformFigure[]
  evidenceText: string
}): string {
  const r = args.record
  const facts = [
    `Name: ${r.name ?? 'unnamed'}`,
    r.location ? `Location: ${r.location}` : null,
    r.sector ? `Sector: ${r.sector}` : null,
    r.status ? `Status: ${r.status}` : null,
    r.stage ? `Stage: ${r.stage}` : null,
    r.counterparty ? `Counterparty: ${r.counterparty}` : null,
    r.description ? `Description: ${r.description}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return [
    `THE RECORD\n${facts}`,
    '',
    `FIGURES ON FILE\n${figureBlock(args.figures)}`,
    '',
    `WHAT I WANT\n${args.instructions}`,
    '',
    'THE RECORDS THIS DEAL HOLDS — correspondence, meetings and documents, newest',
    `first. This is your only source of fact.\n\n${args.evidenceText}`,
  ].join('\n')
}

export async function composeDocument(args: {
  target: ComposeTarget
  documentKind: string
  instructions: string
  requestedBy: { id: string; email: string | null }
  /** Compose and file, but send no text. Used by the verification script. */
  skipText?: boolean
}): Promise<ComposeResult> {
  const spec = composeKind(args.documentKind)
  if (!spec) {
    // Named, so a stale picker or a typo is diagnosable rather than "400".
    throw new ComposeError(
      `This build does not know a document kind called "${args.documentKind}".`,
      400
    )
  }
  const instructions = args.instructions.trim()
  if (instructions.length < 10) {
    throw new ComposeError('Say what the document should cover — a sentence is enough.', 400)
  }

  const supabase = createAdminClient()
  const tables = TABLES[args.target.kind]

  // ── 1. The record ─────────────────────────────────────────────────────────
  const columns =
    args.target.kind === 'project'
      ? 'id, name, description, location, sector, status, stage, estimated_value, confidential'
      : 'id, name, description, location, sector, status, counterparty, estimated_value'

  const { data: recordData, error: recordErr } = await supabase
    .from(tables.record)
    .select(columns)
    .eq('id', args.target.id)
    .maybeSingle()
  if (recordErr) throw new ComposeError(recordErr.message, 500)
  if (!recordData) throw new ComposeError('Record not found.', 404)
  const record = recordData as unknown as RecordRow

  /**
   * ⚠ CONTAINMENT, CHECKED HERE AND NOT LEFT TO THE CALLER.
   *
   * A protected project composes in-platform and NOTHING leaves the box: no
   * Google Doc, no PDF in a shared folder, no text. §8/§12 — containment and
   * access are different questions and only one can be unlocked; a Drive copy
   * is shared outside the tailnet and cannot be withdrawn once made, and a text
   * has already been delivered by the time anyone reconsiders. So this is the
   * absolute answer with no opt-out parameter, and it applies to both admins.
   *
   * `isConfidentialProject` fails closed to true on a database error.
   */
  const contained =
    args.target.kind === 'project' ? await isConfidentialProject(args.target.id) : false

  // ── 2. The job row, BEFORE any work ───────────────────────────────────────
  // §12: work fired off after a route handler returns dies with the next
  // kickstart. This row is what a later page load — or the morning after a
  // deploy — reads to find out what happened.
  const stale = new Date(Date.now() - COMPOSE_STALE_MS).toISOString()
  const { data: running } = await supabase
    .from('composed_documents')
    .select('id')
    .eq(tables.parentCol, args.target.id)
    .eq('status', 'composing')
    .gt('requested_at', stale)
    .limit(1)
  if ((running ?? []).length > 0) {
    throw new ComposeError(
      'A document is already being written for this record. It will arrive by text when it is done.',
      409
    )
  }

  // Both parent columns written explicitly rather than through a computed key:
  // the exactly-one CHECK is the contract, and spelling both sides out is what
  // lets the generated types verify it. §4 forbids an `as never` cast and there
  // are zero in the tree.
  const parent =
    args.target.kind === 'project'
      ? { project_id: args.target.id, opportunity_id: null }
      : { project_id: null, opportunity_id: args.target.id }

  const { data: job, error: jobErr } = await supabase
    .from('composed_documents')
    .insert({
      ...parent,
      document_kind: args.documentKind,
      instructions,
      status: 'composing',
      requested_by: args.requestedBy.id,
    })
    .select('id')
    .single()
  if (jobErr || !job) throw new ComposeError(`Could not start: ${jobErr?.message}`, 500)
  const requestId = (job as { id: string }).id

  const fail = async (message: string): Promise<ComposeResult> => {
    await supabase
      .from('composed_documents')
      .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
      .eq('id', requestId)
    return {
      requestId,
      status: 'failed',
      title: null,
      documentId: null,
      driveFileUrl: null,
      contained,
      texted: false,
      error: message,
      evidenceTruncated: 0,
    }
  }

  try {
    // ── 3. What the deal holds ──────────────────────────────────────────────
    const evidence = await gatherEvidence({ kind: args.target.kind, recordId: args.target.id })
    if (evidence.error) return await fail(`Could not read the deal's records: ${evidence.error}`)
    if (evidence.items.length === 0) {
      return await fail(
        'There is nothing on this record yet — no correspondence, meetings or documents — so there is nothing to write from.'
      )
    }

    const evidenceText = evidence.items
      .map((item) => `### ${item.label} (${item.kind}${item.at ? `, ${item.at.slice(0, 10)}` : ''})\n${item.text}`)
      .join('\n\n')

    const figures = platformFigures(record)
    const company = await getCompanyContext()

    // ── 4. The model writes the prose ───────────────────────────────────────
    const { data } = await callGemini<string>({
      task: `document-compose: ${spec.label} — ${record.name ?? args.target.id}`,
      promptVersion: 'document-compose-1.0',
      systemPrompt: systemPrompt(args.documentKind, company?.text ?? null),
      userMessage: userMessage({
        record,
        kindLabel: spec.label,
        instructions,
        figures,
        evidenceText,
      }),
      userId: args.requestedBy.id,
      // Prose, not JSON: a multi-thousand-character Markdown body inside a JSON
      // string is a needless escaping hazard on a 35B local model, and the
      // title is recoverable from the first heading.
      jsonMode: false,
      maxTokens: 8_000,
    })

    const markdown = (typeof data === 'string' ? data : String(data ?? '')).trim()
    if (markdown.length < 200) {
      // ⚠ Qwen's thinking variants can spend a whole generation inside <think>
      // and emit nothing. An empty answer is a failure with a reason, never a
      // blank document filed on a deal.
      return await fail(
        `The model returned almost nothing (${markdown.length} characters). Nothing was filed. Try again — if it repeats, check that LM Studio has the chat model loaded.`
      )
    }
    const body = markdown.slice(0, MAX_BODY_CHARS)

    // ── 5. THE FIGURE GUARD ─────────────────────────────────────────────────
    // Every money and percentage figure in the output must appear in the input.
    // The model composes prose; it does not do arithmetic (§12 — handed a
    // 69-row schedule it answered 62).
    const allowed = collectAllowedFigures({
      instructions,
      evidenceText,
      platform: figures,
    })
    const offenders = unsourcedFigures(body, allowed)
    if (offenders.length > 0) {
      return await fail(unsourcedMessage(offenders))
    }

    const title =
      titleFromMarkdown(body) ||
      `${record.name ?? 'Untitled'} — ${spec.fileNoun}`
    const docBody = bodyWithoutTitle(body)
    const plainText = markdownToPlainText(body)

    // ── 6. Custody: the editable Doc in the deal's folder ───────────────────
    let driveFileId: string | null = null
    let driveFileUrl: string | null = null
    let pdf: Buffer | null = null

    if (!contained && isGoogleConfigured()) {
      try {
        const folder = await recordDriveFolder(args.target.kind, args.target.id)
        const html = markdownToHtml(docBody, title)
        const created = await createDocFromBytes({
          name: safeFileName(title),
          folderId: folder.folderId,
          bytes: Buffer.from(html, 'utf8'),
          sourceMimeType: 'text/html',
          mailbox: PRIMARY_MAILBOX,
        })
        driveFileId = created.id
        driveFileUrl = created.webViewLink ?? null
        pdf = Buffer.from(await exportDocAsPdf(created.id, PRIMARY_MAILBOX))
      } catch (err) {
        // ⚠ DRIVE FAILING MUST NOT LOSE THE DOCUMENT. The prose took minutes of
        // model time; it is filed on the record below either way and the job row
        // says Drive did not take it. A Drive outage is not a reason to make
        // Richard ask twice.
        const detail = err instanceof Error ? err.message : String(err)
        await supabase
          .from('composed_documents')
          .update({ error: `Filed on the record, but Drive refused it: ${detail}` })
          .eq('id', requestId)
      }
    }

    // ── 7. The record's own copy, which owns the index ──────────────────────
    const fileName = `${safeFileName(title)}.${pdf ? 'pdf' : 'md'}`
    const bytes = pdf ?? Buffer.from(body, 'utf8')
    const storagePath = `composed/${args.target.kind}/${args.target.id}/${Date.now()}_${fileName}`
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, bytes, {
        contentType: pdf ? 'application/pdf' : 'text/markdown',
        upsert: true,
      })
    if (upErr) return await fail(`Could not store the document: ${upErr.message}`)

    /**
     * ⚠ TWO TABLES, AND THE PAYLOAD IS BUILT ONCE. `documents` has no
     * `opportunity_id` — an opportunity's documents are their own table (§2) —
     * so the only honest way to write both is to share the columns and branch
     * on the insert. Every column below exists on both tables; `source` is
     * deliberately omitted because only `documents` has it and its default is
     * already right.
     */
    const docPayload = {
      storage_path: storagePath,
      file_name: fileName,
      file_size_bytes: bytes.length,
      mime_type: pdf ? 'application/pdf' : 'text/markdown',
      doc_type: spec.docType,
      ai_summary: `${spec.label} written by Ber AI on ${new Date().toISOString().slice(0, 10)} from the records on this deal. Asked for: ${instructions.slice(0, 300)}`,
      extracted_text: plainText,
      content_sha256: createHash('sha256').update(bytes).digest('hex'),
      drive_file_id: driveFileId,
      /**
       * ⚠ NOT INDEXED UNTIL A HUMAN CONFIRMS IT, AND THAT IS THE POINT.
       *
       * Embedding this now would put Ber AI's own draft prose into the corpus it
       * retrieves from, so next week the offer it invented reads back as
       * evidence about the deal. §12 — a matcher must never learn from its own
       * matches; the display-name version of that bug turned out to be 27% of
       * the commitment ledger. `filing_confirmed_at` is the human's "this is
       * right", and indexing follows that, not this.
       */
      embedding_status: 'skipped',
    }

    const { data: docRow, error: docErr } =
      args.target.kind === 'project'
        ? await supabase
            .from('documents')
            .insert({ ...docPayload, project_id: args.target.id })
            .select('id')
            .single()
        : await supabase
            .from('opportunity_documents')
            .insert({ ...docPayload, opportunity_id: args.target.id })
            .select('id')
            .single()

    if (docErr || !docRow) {
      await supabase.storage.from('documents').remove([storagePath])
      return await fail(`Could not file the document on the record: ${docErr?.message}`)
    }
    const documentId = (docRow as { id: string }).id

    // ── 8. Settle the job row ───────────────────────────────────────────────
    await supabase
      .from('composed_documents')
      .update({
        status: 'ready',
        title,
        document_id: documentId,
        document_table: tables.docs,
        drive_file_id: driveFileId,
        drive_file_url: driveFileUrl,
        sources: evidence.items.map((i) => ({
          kind: i.kind,
          ref: i.ref,
          label: i.label,
          at: i.at,
        })) as unknown as JsonIn,
        figures: figures as unknown as JsonIn,
        completed_at: new Date().toISOString(),
      })
      .eq('id', requestId)

    // ── 9. Tell the person who asked ────────────────────────────────────────
    let texted = false
    if (!contained && !args.skipText && args.requestedBy.email) {
      const link = driveFileUrl ?? `${process.env.APP_URL ?? ''}/${args.target.kind}s/${args.target.id}/documents`
      const lines = [
        `${spec.fileNoun} ready — ${record.name ?? 'your record'}`,
        title,
        link,
      ]
      if (spec.legal === 'needs_counsel') lines.push('Not reviewed by counsel.')
      const result = await notify({
        kind: 'document_ready',
        channel: 'text',
        to: args.requestedBy.email,
        subject: `${spec.fileNoun} ready`,
        html: '',
        text: lines.join('\n'),
        textKind: 'document_ready',
      })
      texted = result.ok
    }

    return {
      requestId,
      status: 'ready',
      title,
      documentId,
      driveFileUrl,
      contained,
      texted,
      error: null,
      evidenceTruncated: evidence.truncatedItems,
    }
  } catch (err) {
    // Any throw from here must settle the row, or it reads as composing forever.
    const detail = err instanceof Error ? err.message : String(err)
    return await fail(detail)
  }
}
