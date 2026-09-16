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
  type DriveFileRef,
} from '@/lib/integrations/google-drive-write'
import { getDocMeta, getDocPlainText, replaceLiteralsInDoc } from '@/lib/integrations/google-docs'
import { assertTemplateHasTokens } from './quote-guard'

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
  // — Cover —
  ['MIRA VISTA', '{{PROJECT_NAME}}'],
  ['500 South 1040 East, American Fork, Utah', '{{SITE_ADDRESS}}'],
  ['44,400 square feet • 3 floors', '{{BUILDING_SUMMARY}}'],
  ['Wood framing converted to engineered prefab steel panels', '{{SCOPE_SUMMARY}}'],
  ['info@berwilson.com • 385-436-5507', '{{CONTACT_LINE}}'],
  // The original carries no quote number; generation needs one, and appending
  // it to the date cell adds it without having to insert a table row (which
  // text replacement cannot do).
  ['September 16, 2026', '{{QUOTE_DATE}}  ·  Quote {{QUOTE_NUMBER}}'],

  // — Prose forms of the installation rate, before the bare figures —
  ['totaling $666,000 for 44,400 square feet', 'totaling {{INSTALL_AMOUNT}} for {{SF_PLAIN}} square feet'],
  ['$15.00 per square foot', '{{INSTALL_RATE_PLAIN}} per square foot'],

  // — Price table —
  ['Engineering conversion and complete prefab panel material package', '{{KIT_SCOPE}}'],
  ['Ber Wilson installation, equipment, and crane', '{{INSTALL_SCOPE}}'],
  ['44,400 SF', '{{SF}}'],
  ['$33.00/SF', '{{KIT_RATE}}'],
  ['$15.00/SF', '{{INSTALL_RATE}}'],
  ['$48.00/SF', '{{TOTAL_RATE}}'],
  ['$1,465,200', '{{KIT_AMOUNT}}'],
  ['$666,000', '{{INSTALL_AMOUNT}}'],
  ['$2,131,200', '{{TOTAL_AMOUNT}}'],

  // — Payment milestones —
  ['$333,000', '{{MILESTONE_1_AMOUNT}}'],
  ['$166,500', '{{MILESTONE_2_AMOUNT}}'],
  ['$133,200', '{{MILESTONE_3_AMOUNT}}'],
  ['$33,300', '{{MILESTONE_4_AMOUNT}}'],

  // — Quote terms: state the actual expiry date, not just a duration —
  ['Quote valid for 30 calendar days and subject', 'Quote valid through {{VALID_UNTIL}} and subject'],

  // — Acceptance block. The anchored forms matter: a bare "info@berwilson.com"
  //   would also match the page footer, which is the company's own identity and
  //   stays literal. —
  ['Company: Four Amigos Development, LLC', 'Company: {{CLIENT_COMPANY}}'],
  ['Four Amigos Development, LLC', '{{OWNER}}'],
  ['Ericson Tua’one', '{{ESTIMATOR_NAME}}'],
  ['Email: info@berwilson.com', 'Email: {{ESTIMATOR_EMAIL}}'],
  ['Phone: 385-436-5507', 'Phone: {{ESTIMATOR_PHONE}}'],

  // — The DRAFT banner is a FOOTER PREFIX, so it shows on every page and
  //   collapses to nothing on a clean quote. —
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

  // One ordered batch. The find side here is the reference document's own
  // prose, not a token, which is why this uses the literal form.
  await replaceLiteralsInDoc(created.id, TOKENIZE, mailbox)

  const text = await getDocPlainText(created.id, mailbox)
  assertTemplateHasTokens(text)

  // Writer, on this one file only. Everything the platform publishes stays
  // reader; the template is the deliberate exception.
  await shareFileWithRole(created.id, 'writer', mailbox)

  const meta = await getDocMeta(created.id, mailbox)
  return { id: created.id, name: created.name, revisionId: meta.revisionId, webViewLink: created.webViewLink }
}
