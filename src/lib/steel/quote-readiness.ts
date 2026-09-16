/**
 * Can this deal be quoted, and if not, exactly what is missing?
 *
 * The Generate button's disabled state and the reasons shown to the user come
 * from THIS function and nowhere else. A second, hand-maintained list of
 * "things a quote needs" would drift, and the failure mode of drift here is a
 * quote that generates with blanks on it and gets sent to a customer.
 */

import { computeQuoteAmounts, type QuoteInput, type QuoteLine } from './quote-tokens'
import { isInstallCategory, steelCategory, lineItemLabel } from '@/lib/utils/steel'

export interface ReadinessItem {
  /** The deal field or concept at fault, for linking the user at the fix. */
  field: string
  label: string
  reason: string
}

export interface QuoteReadiness {
  ready: boolean
  blockers: ReadinessItem[]
  warnings: ReadinessItem[]
}

type ReadinessDeal = QuoteInput['deal'] & { pricing_below_floor?: boolean | null; value?: number | null }

export function quoteReadiness(
  deal: ReadinessDeal,
  lines: QuoteLine[],
  estimator: { name: string | null; email: string | null } | null,
  company: { email: string | null; phone: string | null } | null
): QuoteReadiness {
  const blockers: ReadinessItem[] = []
  const warnings: ReadinessItem[] = []
  const a = computeQuoteAmounts(lines, deal.square_feet)

  // The entire document is shaped as $/SF — every price row states a rate, and
  // two of the callouts restate it in prose. Without square footage there is no
  // rate to state, and a quote with "—" in the Rate column is not a quote.
  if (a.squareFeet <= 0) {
    blockers.push({
      field: 'square_feet',
      label: 'Building size',
      reason: 'Every price on the quote is stated per square foot.',
    })
  }

  if (a.kitAmount <= 0) {
    blockers.push({
      field: 'lines',
      label: 'Material package price',
      reason: 'Add a priced materials or engineering line item.',
    })
  }

  // NOT a blocker: plenty of deals are material supply only. The generator
  // removes the installation sections from the document rather than printing
  // claims about work nobody is doing — see stripInstallSections.

  if (!deal.customer?.trim()) {
    blockers.push({
      field: 'customer',
      label: 'Owner',
      reason: 'Printed on the cover and on the acceptance signature block.',
    })
  }

  if (!deal.site_address?.trim()) {
    blockers.push({
      field: 'site_address',
      label: 'Site address',
      reason: 'The cover states where the building goes.',
    })
  }

  if (!deal.scope_summary?.trim()) {
    blockers.push({
      field: 'scope_summary',
      label: 'Scope summary',
      reason: 'One customer-facing line describing the conversion, e.g. "Wood framing converted to engineered prefab steel panels".',
    })
  }

  if (!estimator?.name?.trim()) {
    blockers.push({
      field: 'salesperson_id',
      label: 'Estimator',
      reason: 'The quote is signed by a named estimator.',
    })
  }

  if (!company?.email?.trim() || !company?.phone?.trim()) {
    blockers.push({
      field: 'company_profile',
      label: 'Company contact details',
      reason: 'Set the email and phone on the company profile — they appear on every page footer.',
    })
  }

  // ── Warnings: the quote will generate, but somebody should look ──

  if (!deal.floors || deal.floors <= 0) {
    warnings.push({
      field: 'floors',
      label: 'Floors not set',
      reason: 'The cover will state square footage without a storey count.',
    })
  }

  // An `other` line (freight, permits) is summed into the material package row,
  // whose default label claims "complete prefab panel material package". That
  // silently misdescribes the scope, so name them and let the author restate
  // the row label rather than discovering it after the quote is sent.
  const otherLines = lines.filter(
    (l) => !isInstallCategory(l.service_type) && steelCategory(l.service_type) === 'other' && (l.price ?? 0) !== 0
  )
  if (otherLines.length > 0) {
    warnings.push({
      field: 'lines',
      label: 'Other line items folded into the material package',
      reason: `${otherLines.map((l) => lineItemLabel(l.description, l.service_type)).join(', ')} — restate the material package row label if these need naming.`,
    })
  }

  if (deal.pricing_below_floor) {
    warnings.push({
      field: 'pricing_below_floor',
      label: 'Priced below the $30/SF floor',
      reason: 'The quote will be marked DRAFT and will need management approval before it can be issued.',
    })
  }

  // `steel_deals.value` is only recomputed when the deal form is saved, so any
  // other write path leaves it stale. The quote always computes from the line
  // rows; a mismatch means the number shown elsewhere in the CRM is the wrong one.
  if (typeof deal.value === 'number' && Math.abs(deal.value - a.total) > 0.5) {
    warnings.push({
      field: 'value',
      label: 'Deal value disagrees with the line items',
      reason: 'The quote uses the line items. Re-save the deal to bring its contract value back in step.',
    })
  }

  if (!estimator?.email?.trim()) {
    warnings.push({
      field: 'salesperson_id',
      label: 'Estimator has no email address',
      reason: 'The company email will be printed instead.',
    })
  }

  return { ready: blockers.length === 0, blockers, warnings }
}
