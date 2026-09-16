/**
 * Last line of defence before a quote becomes a PDF.
 *
 * Everything upstream is narrowed so internal money cannot reach the document —
 * but the template itself is hand-editable by design, and a human can paste
 * anything into it. These checks run against the generated document's own
 * exported text, so they see what the customer would see.
 *
 * ⚠ THIS MODULE DELIBERATELY TAKES THE FULL, UNNARROWED ROW. Everywhere else
 * the defence is a narrow type; here we need the cost figures in order to look
 * for them. Keeping that inversion in one small file is what stops it weakening
 * the narrowing elsewhere.
 */

import { formatMoney } from '@/lib/utils/constants'
import { QUOTE_TOKENS, tokenPlaceholder, type QuoteToken } from './quote-tokens'

export class QuoteGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuoteGuardError'
  }
}

/**
 * Every token the builder produces must be present in the template, checked
 * BEFORE anything is copied. The post-replacement scan catches a token that
 * survived; it cannot catch one a human deleted, because a deleted token leaves
 * no trace — the quote simply goes out missing its total.
 */
export function assertTemplateHasTokens(templateText: string, extra: string[] = []): void {
  const missing: string[] = [
    ...QUOTE_TOKENS.filter((t) => !templateText.includes(tokenPlaceholder(t))).map(tokenPlaceholder),
    ...extra.filter((m) => !templateText.includes(m)),
  ]
  if (missing.length > 0) {
    throw new QuoteGuardError(
      `The quote template is missing ${missing.length} placeholder${missing.length === 1 ? '' : 's'}: ` +
        `${missing.join(', ')}. ` +
        `Someone has edited the template and removed them. Put them back, or re-seed the template.`
    )
  }
}

/** Nothing of the form {{...}} may survive into a document a customer reads. */
export function assertAllTokensReplaced(renderedText: string): void {
  const leftovers = [...renderedText.matchAll(/\{\{([A-Z0-9_]{1,40})\}\}/g)].map((m) => m[0])
  if (leftovers.length > 0) {
    const unique = [...new Set(leftovers)]
    throw new QuoteGuardError(
      `The generated quote still contains unreplaced placeholders: ${unique.join(', ')}. ` +
        `These are probably spelled differently in the template than in the code.`
    )
  }
}

/**
 * No internal money on a customer document.
 *
 * Matching is on the rendered strings rather than the raw numbers, because that
 * is the form they would actually appear in — and it avoids flagging a coincidence
 * like a street number that happens to equal a cost.
 *
 * Costs that are zero or that coincide with a price the customer is meant to see
 * are skipped: a zero-margin line would otherwise make every quote unissuable,
 * and a figure the customer is being charged is not a leak.
 */
export function assertNoCostLeak(
  renderedText: string,
  internal: {
    lineCosts: (number | null)[]
    totalCost: number
    margin: number
    salesCommission: number
    installFee: number | null
    referralFee: number
  },
  customerFacing: number[]
): void {
  const visible = new Set(customerFacing.map((v) => Math.round(v)))
  const candidates: { label: string; value: number }[] = [
    ...internal.lineCosts.map((c, i) => ({ label: `line ${i + 1} cost`, value: c ?? 0 })),
    { label: 'total cost', value: internal.totalCost },
    { label: 'margin', value: internal.margin },
    { label: 'sales commission', value: internal.salesCommission },
    { label: 'install fee', value: internal.installFee ?? 0 },
    { label: 'referral fee', value: internal.referralFee },
  ]

  const found: string[] = []
  for (const c of candidates) {
    if (!isFinite(c.value) || Math.abs(c.value) < 1) continue
    if (visible.has(Math.round(c.value))) continue
    const rendered = formatMoney(c.value)
    if (renderedText.includes(rendered)) found.push(`${c.label} (${rendered})`)
  }

  if (found.length > 0) {
    throw new QuoteGuardError(
      `The generated quote appears to contain internal figures: ${found.join(', ')}. ` +
        `Cost, margin and commission must never reach a customer document — check the template for pasted numbers.`
    )
  }
}

/** Convenience for tests and callers that only have the token map. */
export function unreplacedTokens(renderedText: string): QuoteToken[] {
  return QUOTE_TOKENS.filter((t) => renderedText.includes(tokenPlaceholder(t)))
}
