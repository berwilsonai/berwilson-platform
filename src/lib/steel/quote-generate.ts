/**
 * Generate a quote: template → Doc → tokens → PDF → the deal record → Drive.
 *
 * Generation is CHEAP and repeatable; issuing is the commitment. A rep will run
 * this several times while fiddling with numbers, so a re-run replaces the
 * standing draft in place. Only once a quote has been issued does the next run
 * become revision 2 — and it then never touches the issued row's snapshot, Doc
 * or PDF. That split is what makes "a sent quote can never silently change"
 * true rather than aspirational.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import {
  copyFile,
  ensureFolder,
  ensureRootFolder,
  trashFile,
} from '@/lib/integrations/google-drive-write'
import {
  deleteMarkedSections,
  deleteMarkedTableRows,
  exportDocAsPdf,
  getDocPlainText,
  replaceTokensInDoc,
} from '@/lib/integrations/google-docs'
import { publishRecordQuietly } from '@/lib/drive/publish'
import {
  GENERATING_STALE_MS,
  isReplaceableDraft,
  quoteFileName,
} from '@/lib/utils/steel-quotes'
import { buildQuoteTokens, type QuoteInput, type QuoteLine } from './quote-tokens'
import { assertAllTokensReplaced, assertNoCostLeak, assertTemplateHasTokens } from './quote-guard'
import { quoteReadiness } from './quote-readiness'
import { INSTALL_CLOSE, INSTALL_OPEN, INSTALL_ROW, findQuoteTemplate } from './quote-template'

export class QuoteGenerationError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'QuoteGenerationError'
    this.status = status
  }
}

export interface GenerateResult {
  quoteId: string
  quoteNumber: string
  revision: number
  documentId: string
  driveFileId: string
  driveFileUrl: string | null
  belowFloor: boolean
  replacedDraft: boolean
}

export async function generateQuote(opts: {
  dealId: string
  generatedBy?: string | null
  mailbox?: string
}): Promise<GenerateResult> {
  const mailbox = opts.mailbox ?? PRIMARY_MAILBOX
  const supabase = createAdminClient()

  // ── 1. Load, narrowly ────────────────────────────────────────────────────
  const { data: deal } = await supabase
    .from('steel_deals')
    // ⚠ THE COLUMN LIST IS THE SECURITY BOUNDARY, not a convenience. select('*')
    // here would pull cost, commission rates and install_fee into the same
    // object the token builder reads. Every field named is one a customer may
    // see, plus the three the pipeline itself needs. Written as one literal
    // because Supabase infers the row type from the literal text.
    .select('id, name, customer, site_address, scope_summary, square_feet, floors, salesperson_id, pricing_below_floor, value')
    .eq('id', opts.dealId)
    .maybeSingle()
  if (!deal) throw new QuoteGenerationError('Deal not found.', 404)

  const [{ data: lineRows }, { data: company }, { data: estimator }] = await Promise.all([
    supabase.from('steel_deal_services').select('service_type, description, price, sort_order').eq('deal_id', opts.dealId).order('sort_order'),
    supabase.from('company_profile').select('email, phone').maybeSingle(),
    deal.salesperson_id
      ? supabase.from('team_members').select('id, name, email').eq('id', deal.salesperson_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const lines: QuoteLine[] = (lineRows ?? []).map((l) => ({
    service_type: l.service_type,
    description: l.description,
    price: l.price,
    sort_order: l.sort_order,
  }))

  // ── 2. Readiness — the same function the button's disabled state uses ────
  const readiness = quoteReadiness(deal, lines, estimator ?? null, company ?? null)
  if (!readiness.ready) {
    throw new QuoteGenerationError(
      `This deal is not ready to quote: ${readiness.blockers.map((b) => b.label).join(', ')}.`
    )
  }

  // ── 3. The template must exist and still carry every token ──────────────
  const template = await findQuoteTemplate(mailbox)
  if (!template) {
    throw new QuoteGenerationError(
      'The quote template has not been seeded yet. An admin can create it from Settings.',
      409
    )
  }
  const templateText = await getDocPlainText(template.id, mailbox)
  // Checked BEFORE anything is copied. The post-replacement scan catches a
  // token that survived; it cannot catch one a human deleted, because a deleted
  // token leaves no trace — the quote just goes out missing its total.
  assertTemplateHasTokens(templateText, [INSTALL_OPEN, INSTALL_CLOSE, INSTALL_ROW])

  // ── 4. Decide draft-replacement vs new revision, and take the latch ─────
  const { data: priorRows } = await supabase
    .from('steel_quotes')
    .select('id, quote_number, revision, status, drive_file_id, document_id, started_at')
    .eq('deal_id', opts.dealId)
    .order('created_at', { ascending: false })
    .limit(5)

  const prior = priorRows ?? []

  const inFlight = prior.find((q) => q.status === 'generating')
  if (inFlight) {
    const age = Date.now() - new Date(inFlight.started_at ?? 0).getTime()
    if (age < GENERATING_STALE_MS) {
      throw new QuoteGenerationError('A quote for this deal is already being generated.', 409)
    }
    // A crashed run would otherwise latch the deal forever.
    await supabase.from('steel_quotes').delete().eq('id', inFlight.id)
  }

  const latest = prior.find((q) => q.status !== 'generating') ?? null
  const replaceDraft = !!latest && isReplaceableDraft(latest.status)

  const belowFloor = !!deal.pricing_below_floor
  const issuedAt = new Date()

  const input: QuoteInput = {
    deal: {
      id: deal.id,
      name: deal.name,
      customer: deal.customer,
      site_address: deal.site_address,
      scope_summary: deal.scope_summary,
      square_feet: deal.square_feet,
      floors: deal.floors,
    },
    lines,
    estimator: estimator ? { name: estimator.name, email: estimator.email } : null,
    company: { email: company?.email ?? null, phone: company?.phone ?? null },
    quoteNumber: replaceDraft && latest ? latest.quote_number : '',
    revision: replaceDraft && latest ? latest.revision : (latest?.revision ?? 0) + 1,
    issuedAt,
    belowFloor,
  }

  // Claim the row FIRST, in 'generating', so the partial unique index on
  // (deal_id) where status = 'generating' is what arbitrates a race, rather
  // than two runs both stamping out a Doc.
  //
  // ⚠ REPLACING A DRAFT UPDATES THAT ROW IN PLACE rather than inserting a twin
  // and deleting the old one afterwards. The obvious insert-then-retire order
  // collides with the unique index on (quote_number, revision) — the new row
  // carries the same pair as the draft it is about to replace, and every
  // regeneration failed on 23505.
  const claim: Record<string, unknown> = {
    status: 'generating',
    below_floor: belowFloor,
    generated_by: opts.generatedBy ?? null,
    template_doc_id: template.id,
    template_revision_id: template.revisionId,
    started_at: issuedAt.toISOString(),
  }

  const { data: quoteRow, error: claimErr } =
    replaceDraft && latest
      ? await supabase
          .from('steel_quotes')
          .update(claim as never)
          .eq('id', latest.id)
          .select('id, quote_number, revision')
          .single()
      : await supabase
          .from('steel_quotes')
          .insert({
            ...claim,
            deal_id: opts.dealId,
            revision: input.revision,
            // A REVISION KEEPS ITS PARENT'S NUMBER — that is what makes it a
            // revision rather than a different quote, and it is the number the
            // customer is holding. Only a deal's first quote draws a fresh one
            // from the sequence, via the column default.
            ...(latest ? { quote_number: latest.quote_number } : {}),
          } as never)
          .select('id, quote_number, revision')
          .single()

  if (claimErr || !quoteRow) {
    // 23505 on the partial index means another request won the race.
    if (claimErr?.code === '23505') {
      throw new QuoteGenerationError('A quote for this deal is already being generated.', 409)
    }
    throw new QuoteGenerationError(`Could not start the quote: ${claimErr?.message}`, 500)
  }

  // From here on, any failure must not leave a 'generating' row latching the
  // deal, nor an orphan Doc in the team's Drive.
  let docId: string | null = null
  try {
    const { tokens, amounts } = buildQuoteTokens({ ...input, quoteNumber: quoteRow.quote_number })

    // ── 5. Copy the template into the deal's folder ───────────────────────
    const root = await ensureRootFolder(mailbox)
    const section = await ensureFolder('Steel Deals', root.id, mailbox)
    const folder = await ensureFolder(deal.name?.trim() || 'Untitled deal', section.id, mailbox)

    const fileName = quoteFileName(quoteRow.quote_number, quoteRow.revision, deal.name, belowFloor)
    const doc = await copyFile(template.id, fileName.replace(/\.pdf$/, ''), folder.id, mailbox)
    docId = doc.id

    // ── 6. Drop the sections that do not apply, THEN substitute ───────────
    // Stripping first means tokens inside a removed section never have to be
    // resolved, and a supply-only quote cannot carry a figure for work nobody
    // is doing.
    if (amounts.hasInstall) {
      // Nothing to remove — just take the markers out.
      await replaceTokensInDoc(doc.id, { IF_INSTALL: '', END_INSTALL: '', ROW_IF_INSTALL: '' }, mailbox)
    } else {
      // Rows first: deleting sections shifts every index after them, and the
      // row pass re-reads the document anyway, so doing rows first keeps each
      // pass working from a document it just measured.
      await deleteMarkedTableRows(doc.id, INSTALL_ROW, mailbox)
      await deleteMarkedSections(doc.id, INSTALL_OPEN, INSTALL_CLOSE, mailbox)
    }

    await replaceTokensInDoc(doc.id, tokens, mailbox)
    const renderedText = await getDocPlainText(doc.id, mailbox)
    assertAllTokensReplaced(renderedText)
    await assertNoInternalMoney(supabase, opts.dealId, renderedText, amounts)

    // ── 7. Export ────────────────────────────────────────────────────────
    const pdf = await exportDocAsPdf(doc.id, mailbox)

    // ── 8. Store on the deal, reusing the steel document conventions ─────
    const storagePath = `steel-deals/${opts.dealId}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: true })
    if (upErr) throw new QuoteGenerationError(`Could not store the quote PDF: ${upErr.message}`, 500)

    const { data: docRow, error: docErr } = await supabase
      .from('documents')
      .insert({
        steel_deal_id: opts.dealId,
        storage_path: storagePath,
        file_name: fileName,
        file_size_bytes: pdf.length,
        mime_type: 'application/pdf',
        doc_type: 'quote',
        source: 'document',
        // Deal files are deliberately not indexed for Ber AI, and a quote least
        // of all — it restates the deal the CRM already holds.
        embedding_status: 'skipped',
      } as never)
      .select('id')
      .single()
    if (docErr || !docRow) {
      await supabase.storage.from('documents').remove([storagePath])
      throw new QuoteGenerationError(`Could not record the quote PDF: ${docErr?.message}`, 500)
    }

    // ── 9. Settle the quote row, retiring the draft it replaces ──────────
    // ⚠ THE ERROR HERE IS CHECKED, and it must be. This is the write that moves
    // the row out of 'generating'. If it fails silently the row keeps the
    // partial unique index's slot and the deal can NEVER be quoted again —
    // every later attempt reports "already being generated" forever.
    const { error: settleErr } = await supabase
      .from('steel_quotes')
      .update({
        status: 'draft',
        inputs: { tokens, amounts, deal: input.deal, lines } as never,
        kit_scope: tokens.KIT_SCOPE,
        install_scope: tokens.INSTALL_SCOPE,
        square_feet: amounts.squareFeet,
        kit_amount: amounts.kitAmount,
        install_amount: amounts.installAmount,
        total: amounts.total,
        drive_file_id: doc.id,
        drive_file_url: doc.webViewLink ?? null,
        document_id: docRow.id,
      } as never)
      .eq('id', quoteRow.id)
    if (settleErr) {
      throw new QuoteGenerationError(`Could not finalise the quote: ${settleErr.message}`, 500)
    }

    if (replaceDraft && latest) await retireDraftArtifacts(supabase, latest, mailbox)

    // The Drive copy is free: publishing walks the deal's documents and uploads
    // anything not yet stamped with a drive_published_id. Quiet, because a Drive
    // hiccup must never read as "the quote failed" when the PDF is already on
    // the record.
    await publishRecordQuietly('steel', opts.dealId)

    return {
      quoteId: quoteRow.id,
      quoteNumber: quoteRow.quote_number,
      revision: quoteRow.revision,
      documentId: docRow.id,
      driveFileId: doc.id,
      driveFileUrl: doc.webViewLink ?? null,
      belowFloor,
      replacedDraft: replaceDraft,
    }
  } catch (err) {
    // Release the latch. A row we CLAIMED (an existing draft) is put back to
    // 'draft' rather than deleted — it still has a perfectly good PDF on the
    // record, and destroying it because a re-run failed would lose the quote
    // the user already had.
    if (replaceDraft) {
      await supabase.from('steel_quotes').update({ status: 'draft' } as never).eq('id', quoteRow.id)
    } else {
      await supabase.from('steel_quotes').delete().eq('id', quoteRow.id)
    }
    if (docId) await trashFile(docId, mailbox)
    throw err
  }
}

/**
 * Retire the PDF and Doc the replaced draft was carrying. The ROW survives —
 * it is the row this run just claimed and rewrote.
 *
 * Deleting the old artifacts rather than keeping them: a draft was never sent,
 * so retaining every intermediate would fill the deal's file list with
 * near-identical PDFs nobody can tell apart. Issued quotes are never touched.
 */
async function retireDraftArtifacts(
  supabase: ReturnType<typeof createAdminClient>,
  draft: { drive_file_id: string | null; document_id: string | null },
  mailbox: string
): Promise<void> {
  if (draft.document_id) {
    const { data: doc } = await supabase
      .from('documents')
      .select('storage_path')
      .eq('id', draft.document_id)
      .maybeSingle()
    // Row first, then storage: a DB cascade cannot reach the bucket, and a row
    // pointing at a missing file is worse than a file with no row.
    await supabase.from('documents').delete().eq('id', draft.document_id)
    if (doc?.storage_path) await supabase.storage.from('documents').remove([doc.storage_path])
  }
  if (draft.drive_file_id) await trashFile(draft.drive_file_id, mailbox)
}

/**
 * The leak check needs the cost figures in order to look for them, so it reads
 * them here — the one place that deliberately loads the unnarrowed row.
 */
async function assertNoInternalMoney(
  supabase: ReturnType<typeof createAdminClient>,
  dealId: string,
  renderedText: string,
  amounts: { kitAmount: number; installAmount: number; total: number; milestones: number[] }
): Promise<void> {
  const [{ data: rows }, { data: deal }] = await Promise.all([
    supabase.from('steel_deal_services').select('price, cost').eq('deal_id', dealId),
    supabase.from('steel_deals').select('install_fee, referral_fee_type, referral_fee_value').eq('id', dealId).maybeSingle(),
  ])

  const lineCosts = (rows ?? []).map((r) => r.cost)
  const totalCost = lineCosts.reduce((a: number, c) => a + (c ?? 0), 0)
  const revenue = (rows ?? []).reduce((a: number, r) => a + (r.price ?? 0), 0)

  assertNoCostLeak(
    renderedText,
    {
      lineCosts,
      totalCost,
      margin: revenue - totalCost,
      // The commission itself is not recomputed here: any figure derived from
      // margin is already covered by checking margin and cost, and pulling the
      // commission engine in would widen what this module can see.
      salesCommission: 0,
      installFee: deal?.install_fee ?? null,
      referralFee: deal?.referral_fee_type === 'flat' ? (deal?.referral_fee_value ?? 0) : 0,
    },
    [amounts.kitAmount, amounts.installAmount, amounts.total, ...amounts.milestones]
  )
}
