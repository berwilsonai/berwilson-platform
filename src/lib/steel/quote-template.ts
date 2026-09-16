/**
 * The quote template: a Google Doc holding all the boilerplate wording, with
 * {{TOKENS}} where the numbers go.
 *
 * It lives in Drive rather than in code so Richard can change "30 calendar
 * days" to 45, or reword an exclusion, without a deploy. Everything the
 * customer reads that is NOT a number — the 9 inclusions, the 7 exclusions, the
 * schedule comparison, the payment terms, the delivery options — is his to edit.
 *
 * ⚠ IT MUST BE APP-CREATED. The platform holds `drive.file`, a per-file grant
 * covering only files it made itself. A Doc uploaded by hand is invisible to
 * that scope no matter how readable it is through drive.readonly, and could
 * never be copied. So the template is seeded from a checked-in .docx, and
 * `findQuoteTemplate` looks it up by name — which, under drive.file, can only
 * ever find the app's own file. That is why there is no env var and no config
 * column pointing at it.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import {
  PRIMARY_MAILBOX,
} from '@/lib/integrations/google-workspace'
import {
  createDocFromBytes,
  ensureFolder,
  ensureRootFolder,
  findFile,
  shareFileWithRole,
  trashFile,
  type DriveFileRef,
} from '@/lib/integrations/google-drive-write'
import { getDocMeta, getDocPlainText, replaceLiteralsInDoc } from '@/lib/integrations/google-docs'
import { assertTemplateHasTokens } from './quote-guard'

/**
 * Wraps the parts of the document that are only true when Ber Wilson is doing
 * the installation. On a supply-only quote the generator deletes these regions
 * outright rather than printing claims about work nobody is doing.
 *
 * Deliberately shaped like the other tokens (`{{UPPER_SNAKE}}`) so that a
 * marker which somehow survives is caught by the same post-replacement guard
 * that catches an unreplaced token, instead of reaching a customer.
 */
export const INSTALL_OPEN = '{{IF_INSTALL}}'
export const INSTALL_CLOSE = '{{END_INSTALL}}'

/**
 * Marks a single TABLE ROW as install-only — the mobilization and remaining-
 * payments rows of the Payment Summary. A row cannot be wrapped in an
 * open/close pair the way a section can, because a range spanning part of a
 * table is not deletable; rows are removed with deleteTableRow instead.
 */
export const INSTALL_ROW = '{{ROW_IF_INSTALL}}'

export const TEMPLATE_FOLDER_NAME = 'Templates'
export const TEMPLATE_DOC_NAME = 'Prefab Steel Quote Template'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const TEMPLATE_ASSET = path.join(process.cwd(), 'assets', 'steel-quote-template.docx')

/**
 * The reference document's literal values, mapped to the tokens that replace
 * them. Applied ONCE at seed time, against the converted Doc rather than the
 * .docx XML — Word splits a phrase across several runs, so "44,400 SF" is
 * rarely a single string in the file, while the Docs API matches rendered text.
 *
 * ⚠ ORDER IS LOAD-BEARING. Docs applies the requests in sequence, so anything
 * whose text CONTAINS another entry's text has to come first:
 *   - "44,400 square feet • 3 floors" before "for 44,400 square feet" before "44,400 SF"
 *   - "$15.00/SF" before "$15.00 per square foot"
 *   - "Company: Four Amigos…" before the bare company name
 * Get this wrong and a token lands inside another token's text.
 */
const TOKENIZE: [find: string, replace: string][] = [
  // The BODY already carries every token — `scripts/build-quote-template.mjs`
  // writes them straight into the .docx. Only the page FOOTER is left, because
  // it lives in footer1.xml which that script does not rewrite, and because the
  // DRAFT banner has to appear on every page.
  //
  // The banner is a footer PREFIX and carries its own trailing separator, so a
  // clean quote collapses it to nothing instead of leaving a stray divider.
  ['BER WILSON  |  BUILDING FUTURES', '{{DRAFT_BANNER}}BER WILSON  |  BUILDING FUTURES'],
]

export interface QuoteTemplate {
  id: string
  name: string
  revisionId: string
  webViewLink?: string
}

/** `Ber Intelligence / Templates`. */
export async function ensureTemplateFolder(mailbox: string = PRIMARY_MAILBOX): Promise<DriveFileRef> {
  const root = await ensureRootFolder(mailbox)
  return ensureFolder(TEMPLATE_FOLDER_NAME, root.id, mailbox)
}

/** The template, or null when it has never been seeded. */
export async function findQuoteTemplate(
  mailbox: string = PRIMARY_MAILBOX
): Promise<QuoteTemplate | null> {
  const folder = await ensureTemplateFolder(mailbox)
  const file = await findFile(mailbox, TEMPLATE_DOC_NAME, folder.id)
  if (!file) return null
  const meta = await getDocMeta(file.id, mailbox)
  return { id: file.id, name: file.name, revisionId: meta.revisionId, webViewLink: file.webViewLink }
}

/**
 * Create the template from the checked-in .docx: upload with conversion, swap
 * the reference document's numbers for tokens, verify, and grant the domain
 * write access so the wording can be edited without a deploy.
 *
 * Refuses to run when a template already exists. Re-seeding would silently
 * discard Richard's wording edits, so replacing one is a deliberate two-step:
 * rename or delete the old Doc first.
 */
export async function seedQuoteTemplate(opts: { mailbox?: string } = {}): Promise<QuoteTemplate> {
  const mailbox = opts.mailbox ?? PRIMARY_MAILBOX

  const existing = await findQuoteTemplate(mailbox)
  if (existing) {
    throw new Error(
      `A quote template already exists (${existing.id}). Rename or delete it in Drive first — ` +
        `re-seeding would discard any wording edits made to it.`
    )
  }

  let bytes: Buffer
  try {
    bytes = await fs.readFile(TEMPLATE_ASSET)
  } catch {
    throw new Error(
      `Template source missing at ${TEMPLATE_ASSET}. Rebuild it with: ` +
        `node scripts/build-quote-template.mjs <source.docx>`
    )
  }

  const folder = await ensureTemplateFolder(mailbox)
  const created = await createDocFromBytes({
    name: TEMPLATE_DOC_NAME,
    folderId: folder.id,
    bytes,
    sourceMimeType: DOCX_MIME,
    mailbox,
  })

  try {
    // One ordered batch. The find side here is the reference document's own
    // prose, not a token, which is why this uses the literal form.
    await replaceLiteralsInDoc(created.id, TOKENIZE, mailbox)

    const text = await getDocPlainText(created.id, mailbox)
    assertTemplateHasTokens(text, [INSTALL_OPEN, INSTALL_CLOSE, INSTALL_ROW])
  } catch (err) {
    // Leave nothing behind. A half-built template would be found by name on the
    // next attempt and make every retry fail with "already exists".
    await trashFile(created.id, mailbox)
    throw err
  }

  // Writer, on this one file only. Everything the platform publishes stays
  // reader; the template is the deliberate exception.
  await shareFileWithRole(created.id, 'writer', mailbox)

  const meta = await getDocMeta(created.id, mailbox)
  return { id: created.id, name: created.name, revisionId: meta.revisionId, webViewLink: created.webViewLink }
}
