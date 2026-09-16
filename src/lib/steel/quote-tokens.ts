/**
 * Quote token builder — turns a steel deal into the {{TOKEN}} map that gets
 * substituted into the Google Doc template.
 *
 * ⚠ THE INPUT TYPE IS DELIBERATELY NARROW. `QuoteInput` contains no `cost`,
 * `cost_per_sqft`, `commission_pct`, `install_fee`, `sales_rate_override` or
 * `description`. The document this produces is customer-facing, and the only
 * durable way to stop internal money reaching it is to make the builder unable
 * to see it — a leak becomes a compile error rather than a code review.
 *
 * The frozen snapshot stored on `steel_quotes.inputs` is built from this same
 * type, so the snapshot inherits the guarantee. That matters because steel_sales
 * reps can read that table but are barred from financials.
 */

import { formatMoney, formatRatePerSqft } from '@/lib/utils/constants'
import { formatSqft, isInstallCategory } from '@/lib/utils/steel'

/** A line item, stripped to the fields a customer may see. */
export interface QuoteLine {
  service_type: string
  description: string | null
  price: number | null
  sort_order: number | null
}

export interface QuoteInput {
  deal: {
    id: string
    name: string
    customer: string | null
    site_address: string | null
    scope_summary: string | null
    square_feet: number | null
    floors: number | null
  }
  lines: QuoteLine[]
  estimator: { name: string | null; email: string | null } | null
  company: { email: string | null; phone: string | null }
  quoteNumber: string
  revision: number
  /** Generation time. Passed in, never read from the clock here, so the builder stays pure. */
  issuedAt: Date
  /** How long the quote stands. The template's Quote Terms says 30 calendar days. */
  validDays?: number
  /**
   * Override the price table's row labels. Normally left unset: the labels are
   * taken from what the rep actually typed on the line items, which is the
   * only mapping anyone would guess.
   */
  kitScope?: string | null
  installScope?: string | null
  /** Below the $30/SF floor — drives the DRAFT banner rather than blocking. */
  belowFloor?: boolean
}

export interface QuoteAmounts {
  /** Is Ber Wilson installing? Drives which sections the document keeps. */
  hasInstall: boolean
  squareFeet: number
  kitAmount: number
  installAmount: number
  total: number
  kitRate: number
  installRate: number
  totalRate: number
  /** 50% of installation, collected at signing with the materials. */
  mobilization: number
  /** The three progress payments: 25% / 20% / 5% of installation. */
  milestones: [number, number, number]
  /** 100% of materials + the mobilization. The cheque written at signing. */
  dueAtSigning: number
  /** What is still to come after signing — the three milestones. */
  remainingPayments: number
}

export const DEFAULT_KIT_SCOPE = 'Engineering conversion and complete prefab panel material package'
export const DEFAULT_INSTALL_SCOPE = 'Ber Wilson installation, equipment, and crane'
export const DEFAULT_VALID_DAYS = 30

/**
 * Installation is paid 50 / 25 / 20 / 5. The 50% is a MOBILIZATION payment
 * collected at signing alongside 100% of the materials, which is why it is
 * separated here: the document shows one "due upon signing" figure and then
 * three progress milestones, rather than four undifferentiated milestones.
 */
export const INSTALL_MOBILIZATION_FRACTION = 0.5
export const MILESTONE_FRACTIONS = [0.25, 0.2, 0.05] as const

const n = (v: number | null | undefined): number => (typeof v === 'number' && isFinite(v) ? v : 0)
const round2 = (v: number): number => Math.round(v * 100) / 100

/**
 * Every token the template may contain. Kept as one exported list so the
 * template-integrity check and the post-replacement guard cannot drift from
 * what the builder actually produces.
 */
export const QUOTE_TOKENS = [
  'PROJECT_NAME',
  'SITE_ADDRESS',
  'OWNER',
  'BUILDING_SUMMARY',
  'SCOPE_SUMMARY',
  'ESTIMATOR_NAME',
  'ESTIMATOR_EMAIL',
  'ESTIMATOR_PHONE',
  'CONTACT_LINE',
  'QUOTE_DATE',
  'QUOTE_NUMBER',
  'DRAFT_BANNER',
  'SF',
  'KIT_SCOPE',
  'KIT_RATE',
  'KIT_AMOUNT',
  'INSTALL_SCOPE',
  'INSTALL_RATE',
  'INSTALL_AMOUNT',
  'TOTAL_RATE',
  'TOTAL_AMOUNT',
  // TURNKEY or MATERIALS. A quote with no installation scope must not call
  // itself a turnkey quote.
  'QUOTE_KIND',
  'QUOTE_KIND_UPPER',
  // Mid-sentence, where "the full turnkey contract amount" reads as prose and
  // "the full Turnkey contract amount" reads as a mistake.
  'QUOTE_KIND_LOWER',
  // The clause naming installation inside the cover summary sentence, or empty
  // on a supply-only quote. A token rather than a whole alternative sentence so
  // the sentence around it stays Richard's to edit.
  'TURNKEY_INCLUDES_INSTALL',
  // ── The payment breakdown, which is what the document is really for ──
  // 100% of materials + 50% of installation, collected at signing.
  'DUE_AT_SIGNING',
  // How that figure is arrived at, spelled out in the Calculation column.
  'EXECUTION_CALC',
  'INSTALL_MOBILIZATION',
  'REMAINING_PAYMENTS',
  // The three progress payments after signing: 25% / 20% / 5% of installation.
  'MILESTONE_1_AMOUNT',
  'MILESTONE_2_AMOUNT',
  'MILESTONE_3_AMOUNT',
  'CLIENT_COMPANY',
  'VALID_UNTIL',
] as const

export type QuoteToken = (typeof QUOTE_TOKENS)[number]

/** The literal `{{NAME}}` form, so no caller hand-builds the delimiters. */
export function tokenPlaceholder(name: QuoteToken): string {
  return `{{${name}}}`
}

export function computeQuoteAmounts(
  lines: QuoteLine[],
  squareFeet: number | null | undefined
): QuoteAmounts {
  const sf = n(squareFeet)
  let kitAmount = 0
  let installAmount = 0
  for (const l of lines) {
    if (isInstallCategory(l.service_type)) installAmount += n(l.price)
    else kitAmount += n(l.price)
  }
  const total = kitAmount + installAmount

  // Rates are rounded to the cent BEFORE the total rate is formed, and the
  // total rate is their SUM rather than total/SF. A customer checking the Rate
  // column with a calculator must find that it adds up; the sub-cent divergence
  // from total/SF is invisible, a column that does not add is not.
  const kitRate = sf > 0 ? round2(kitAmount / sf) : 0
  const installRate = sf > 0 ? round2(installAmount / sf) : 0
  const totalRate = round2(kitRate + installRate)

  // Each payment rounds to the dollar; the LAST milestone absorbs whatever is
  // left so the Amounts Due column sums to the contract total exactly. A
  // customer checks that column with a calculator.
  const mobilization = Math.round(installAmount * INSTALL_MOBILIZATION_FRACTION)
  const m1 = Math.round(installAmount * MILESTONE_FRACTIONS[0])
  const m2 = Math.round(installAmount * MILESTONE_FRACTIONS[1])
  const m3 = round2(installAmount - (mobilization + m1 + m2))

  return {
    hasInstall: installAmount > 0,
    squareFeet: sf,
    kitAmount,
    installAmount,
    total,
    kitRate,
    installRate,
    totalRate,
    mobilization,
    milestones: [m1, m2, m3],
    dueAtSigning: round2(kitAmount + mobilization),
    remainingPayments: round2(m1 + m2 + m3),
  }
}

/**
 * Braces are stripped from every substituted value. Without this, a deal named
 * "{{TOTAL_AMOUNT}}" — or any stray brace in an address — would corrupt the
 * post-replacement guard that looks for surviving `{{`.
 */
function safe(value: string | null | undefined): string {
  return (value ?? '').replace(/[{}]/g, '').trim()
}

/**
 * The label for a collapsed price row.
 *
 * N line items become ONE row on the quote, so the row has to say what those
 * lines are. Using the descriptions the rep typed is the behaviour anyone would
 * expect — the boilerplate is only a fallback for lines left unnamed.
 * Duplicates are dropped, because two "Prefab panels" lines should not produce
 * "Prefab panels, Prefab panels".
 */
function scopeLabel(lines: QuoteLine[], fallback: string): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const l of lines) {
    const d = safe(l.description)
    if (!d || seen.has(d.toLowerCase())) continue
    seen.add(d.toLowerCase())
    parts.push(d)
  }
  return parts.length > 0 ? parts.join(', ') : fallback
}

function formatQuoteDate(d: Date): string {
  // Server-side and pinned to the company's timezone. The page this replaces
  // computed the date in the BROWSER, so a quote generated at 11pm MST printed
  // tomorrow's date for a reader in another zone.
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function buildQuoteTokens(input: QuoteInput): {
  tokens: Record<QuoteToken, string>
  amounts: QuoteAmounts
} {
  const a = computeQuoteAmounts(input.lines, input.deal.square_feet)
  const sfPlain = a.squareFeet > 0 ? a.squareFeet.toLocaleString('en-US') : '—'

  const validUntil = new Date(input.issuedAt)
  validUntil.setDate(validUntil.getDate() + (input.validDays ?? DEFAULT_VALID_DAYS))

  const floors = input.deal.floors
  const buildingSummary =
    a.squareFeet > 0
      ? `${sfPlain} square feet${floors && floors > 0 ? ` • ${floors} floor${floors === 1 ? '' : 's'}` : ''}`
      : '—'

  const email = safe(input.company.email)
  const phone = safe(input.company.phone)

  const tokens: Record<QuoteToken, string> = {
    PROJECT_NAME: safe(input.deal.name).toUpperCase(),
    SITE_ADDRESS: safe(input.deal.site_address),
    OWNER: safe(input.deal.customer),
    BUILDING_SUMMARY: buildingSummary,
    SCOPE_SUMMARY: safe(input.deal.scope_summary),

    ESTIMATOR_NAME: safe(input.estimator?.name),
    // A rep with no address falls back to the company mailbox rather than
    // printing a blank line where a customer expects somebody to reply to.
    ESTIMATOR_EMAIL: safe(input.estimator?.email) || email,
    ESTIMATOR_PHONE: phone,
    CONTACT_LINE: [email, phone].filter(Boolean).join(' • '),

    QUOTE_DATE: formatQuoteDate(input.issuedAt),
    QUOTE_NUMBER: input.revision > 1
      ? `${safe(input.quoteNumber)} rev ${input.revision}`
      : safe(input.quoteNumber),

    // Rendered as a prefix to the page footer, so it appears on EVERY page and
    // collapses to nothing when the quote is clean. It carries its own trailing
    // separator for that reason.
    DRAFT_BANNER: input.belowFloor ? 'DRAFT — NOT FOR ISSUE  |  ' : '',

    SF: a.squareFeet > 0 ? formatSqft(a.squareFeet) : '—',

    KIT_SCOPE:
      safe(input.kitScope) ||
      scopeLabel(
        input.lines.filter((l) => !isInstallCategory(l.service_type) && (l.price ?? 0) !== 0),
        DEFAULT_KIT_SCOPE
      ),
    KIT_RATE: formatRatePerSqft(a.kitRate),
    KIT_AMOUNT: formatMoney(a.kitAmount),

    // On a supply-only quote the installation ROW stays and says so, rather
    // than being deleted: a customer reading "Installation — by others" learns
    // something, where a missing row just looks like an omission.
    INSTALL_SCOPE: a.hasInstall
      ? safe(input.installScope) ||
        scopeLabel(
          input.lines.filter((l) => isInstallCategory(l.service_type) && (l.price ?? 0) !== 0),
          DEFAULT_INSTALL_SCOPE
        )
      : 'Installation (by others — not included)',
    // The rate now appears ONLY in the price table. The 2026-09-16 template
    // dropped the prose restatements, which is where a figure goes stale.
    INSTALL_RATE: a.hasInstall ? formatRatePerSqft(a.installRate) : 'Not included',
    INSTALL_AMOUNT: a.hasInstall ? formatMoney(a.installAmount) : 'By others',

    TOTAL_RATE: formatRatePerSqft(a.totalRate),
    TOTAL_AMOUNT: formatMoney(a.total),

    QUOTE_KIND: a.hasInstall ? 'Turnkey' : 'Materials',
    QUOTE_KIND_UPPER: a.hasInstall ? 'TURNKEY' : 'MATERIALS',
    QUOTE_KIND_LOWER: a.hasInstall ? 'turnkey' : 'materials',
    // Carries the whole tail of the delivery sentence, including the
    // conjunction, so both readings are grammatical.
    TURNKEY_INCLUDES_INSTALL: a.hasInstall
      ? ", builder's risk, crane, equipment, and Ber Wilson installation"
      : " and builder's risk",

    DUE_AT_SIGNING: formatMoney(a.dueAtSigning),
    // On a supply-only quote there is no mobilization to add, so the sentence
    // states the materials alone rather than an addition with a zero in it.
    EXECUTION_CALC: a.hasInstall
      ? `${formatMoney(a.kitAmount)} materials + ${formatMoney(a.mobilization)} installation mobilization`
      // Restating the amount would read "$1,020,000 — includes $1,020,000
      // materials", which is the whole contract said twice.
      : '100% of the prefab material package',
    INSTALL_MOBILIZATION: formatMoney(a.mobilization),
    REMAINING_PAYMENTS: formatMoney(a.remainingPayments),
    MILESTONE_1_AMOUNT: formatMoney(a.milestones[0]),
    MILESTONE_2_AMOUNT: formatMoney(a.milestones[1]),
    MILESTONE_3_AMOUNT: formatMoney(a.milestones[2]),

    CLIENT_COMPANY: safe(input.deal.customer),
    VALID_UNTIL: formatQuoteDate(validUntil),
  }

  return { tokens, amounts: a }
}
