/**
 * Steel commission rollups — the single source of truth for per-rep
 * scorecards, the per-rep annual $1M-profit accelerator, the deal-level payout
 * worklist, and the per-source referral-fee rollup. Pure functions (no
 * client/server dependency) so the management commissions page and a rep's own
 * earnings page compute identically.
 *
 * Roles on a deal:
 *   • Salesperson (team member, a flagged steel rep) — sales commission + a
 *     flat install fee. This is what a rep's earnings are.
 *   • Marketing / referral source (any contact / party) — a referral fee, flat
 *     or a % of margin. Tracked per source, not per rep.
 */

import type { SteelDeal, SteelDealService } from '@/lib/supabase/types'
import {
  dealFinancials,
  commissionableMargin,
  isLostStage,
  isCommissionPayable,
  ACCELERATOR_THRESHOLD,
  type DealFinancials,
} from '@/lib/utils/steel'

export interface DealWithLines {
  deal: SteelDeal
  lines: SteelDealService[]
}

/** Group service line rows onto their deals. */
export function groupServices(deals: SteelDeal[], services: SteelDealService[]): DealWithLines[] {
  const byDeal = new Map<string, SteelDealService[]>()
  for (const s of services) {
    const list = byDeal.get(s.deal_id) ?? []
    list.push(s)
    byDeal.set(s.deal_id, list)
  }
  return deals.map((deal) => ({ deal, lines: byDeal.get(deal.id) ?? [] }))
}

function collectedInYear(deal: SteelDeal, year: number): boolean {
  if (!isCommissionPayable(deal.stage)) return false
  // A collected deal missing a collected_date (legacy) doesn't count toward the
  // year's accelerator total — new deals stamp it when they reach Paid.
  return (deal.collected_date ?? '').slice(0, 4) === String(year)
}

/**
 * Gross profit a rep has COLLECTED (as salesperson) in the given calendar year
 * — the figure that drives their accelerator. Profit = commissionable margin.
 */
export function repCollectedProfitYTD(
  rows: DealWithLines[],
  repId: string,
  year: number
): number {
  return rows.reduce((a, { deal, lines }) => {
    if (deal.salesperson_id !== repId) return a
    if (!collectedInYear(deal, year)) return a
    return a + commissionableMargin(lines)
  }, 0)
}

/** Map of team_member id → whether they're accelerated this year (≥ $1M collected profit). */
export function acceleratorMap(rows: DealWithLines[], year: number): Map<string, boolean> {
  const profit = new Map<string, number>()
  for (const { deal, lines } of rows) {
    if (!deal.salesperson_id || !collectedInYear(deal, year)) continue
    profit.set(deal.salesperson_id, (profit.get(deal.salesperson_id) ?? 0) + commissionableMargin(lines))
  }
  const map = new Map<string, boolean>()
  for (const [id, p] of profit) map.set(id, p >= ACCELERATOR_THRESHOLD)
  return map
}

/** Deal financials with the salesperson's accelerator applied. */
export function financialsFor(
  { deal, lines }: DealWithLines,
  accel: Map<string, boolean>
): DealFinancials {
  return dealFinancials(lines, {
    square_feet: deal.square_feet,
    sales_rate_override: deal.sales_rate_override,
    install_fee: deal.install_fee,
    referral_fee_type: deal.referral_fee_type,
    referral_fee_value: deal.referral_fee_value,
    hasSalesperson: !!deal.salesperson_id,
    salesAccelerated: !!(deal.salesperson_id && accel.get(deal.salesperson_id)),
  })
}

// ── Payout worklist ──

export type PayoutKind = 'sales' | 'install' | 'referral'

export const PAYOUT_LABELS: Record<PayoutKind, string> = {
  sales: 'Sales commission',
  install: 'Installation fee',
  referral: 'Referral fee',
}

export interface PayoutItem {
  /** Stable key: `${kind}:${dealId}`. */
  key: string
  dealId: string
  dealName: string
  kind: PayoutKind
  /** team_member id (sales/install) or party id (referral); null when unknown. */
  personId: string | null
  personName: string
  amount: number
  paid: boolean
}

/** Which deal-level paid flag backs a given payout kind. */
export function paidFlagFor(deal: SteelDeal, kind: PayoutKind): boolean {
  switch (kind) {
    case 'sales':
      return deal.sales_commission_paid
    case 'install':
      return deal.install_fee_paid
    case 'referral':
      return deal.referral_fee_paid
  }
}

/** The column name to PATCH when marking a payout kind paid/unpaid. */
export const PAID_FIELD: Record<PayoutKind, string> = {
  sales: 'sales_commission_paid',
  install: 'install_fee_paid',
  referral: 'referral_fee_paid',
}

// ── Per-rep scorecard (sales + install; the marketing/referral fee is a
//    per-source concept, tracked separately by referralSourceRollup) ──

export interface RepBucket {
  owed: number
  paid: number
  projected: number
}
const bucket = (): RepBucket => ({ owed: 0, paid: 0, projected: 0 })

export interface RepScorecard {
  memberId: string
  name: string
  /** Deals where they are the salesperson (non-lost). */
  dealCount: number
  /** Revenue on their salesperson deals. */
  totalSales: number
  /** Commissionable margin (profit) they've generated as salesperson. */
  totalProfit: number
  /** Collected profit this calendar year (accelerator basis). */
  collectedProfitYTD: number
  accelerated: boolean
  sales: RepBucket
  install: RepBucket
  totalOwed: number
  totalPaid: number
  totalProjected: number
}

function add(b: RepBucket, amount: number, payable: boolean, paid: boolean) {
  if (!payable) b.projected += amount
  else if (paid) b.paid += amount
  else b.owed += amount
}

/**
 * Build a scorecard per team member across all non-lost deals. `filterMemberId`
 * limits the result to one rep (their own earnings view); omit for all reps.
 */
export function repScorecards(
  rows: DealWithLines[],
  members: { id: string; name: string }[],
  year: number,
  filterMemberId?: string
): RepScorecard[] {
  const accel = acceleratorMap(rows, year)
  const name = new Map(members.map((m) => [m.id, m.name]))
  const cards = new Map<string, RepScorecard>()

  const ensure = (id: string): RepScorecard => {
    let c = cards.get(id)
    if (!c) {
      c = {
        memberId: id,
        name: name.get(id) ?? 'Unknown',
        dealCount: 0,
        totalSales: 0,
        totalProfit: 0,
        collectedProfitYTD: repCollectedProfitYTD(rows, id, year),
        accelerated: !!accel.get(id),
        sales: bucket(),
        install: bucket(),
        totalOwed: 0,
        totalPaid: 0,
        totalProjected: 0,
      }
      cards.set(id, c)
    }
    return c
  }

  for (const row of rows) {
    const { deal } = row
    if (isLostStage(deal.stage)) continue
    const payable = isCommissionPayable(deal.stage)
    const fin = financialsFor(row, accel)

    if (deal.salesperson_id) {
      const c = ensure(deal.salesperson_id)
      c.dealCount += 1
      c.totalSales += fin.revenue
      c.totalProfit += fin.commissionableMargin
      add(c.sales, fin.salesCommission, payable, deal.sales_commission_paid)
      if (fin.installFee > 0) add(c.install, fin.installFee, payable, deal.install_fee_paid)
    }
  }

  for (const c of cards.values()) {
    c.totalOwed = c.sales.owed + c.install.owed
    c.totalPaid = c.sales.paid + c.install.paid
    c.totalProjected = c.sales.projected + c.install.projected
  }

  const list = [...cards.values()]
  const scoped = filterMemberId ? list.filter((c) => c.memberId === filterMemberId) : list
  return scoped.sort((a, b) => b.totalOwed + b.totalPaid - (a.totalOwed + a.totalPaid))
}

/**
 * Build the payout worklist (collected deals only — real payables).
 * `partyName` resolves referral-source party ids to names.
 */
export function payoutItems(
  rows: DealWithLines[],
  members: { id: string; name: string }[],
  partyName: Map<string, string> = new Map()
): PayoutItem[] {
  const accel = acceleratorMap(rows, new Date().getFullYear())
  const name = new Map(members.map((m) => [m.id, m.name]))
  const items: PayoutItem[] = []

  for (const row of rows) {
    const { deal } = row
    if (isLostStage(deal.stage) || !isCommissionPayable(deal.stage)) continue
    const fin = financialsFor(row, accel)

    const push = (kind: PayoutKind, personId: string | null, personName: string, amount: number) => {
      if (amount <= 0) return
      items.push({
        key: `${kind}:${deal.id}`,
        dealId: deal.id,
        dealName: deal.name,
        kind,
        personId,
        personName,
        amount,
        paid: paidFlagFor(deal, kind),
      })
    }

    push('sales', deal.salesperson_id, name.get(deal.salesperson_id ?? '') ?? PAYOUT_LABELS.sales, fin.salesCommission)
    push('install', deal.salesperson_id, name.get(deal.salesperson_id ?? '') ?? PAYOUT_LABELS.install, fin.installFee)
    push(
      'referral',
      deal.referral_party_id,
      partyName.get(deal.referral_party_id ?? '') ?? 'Referral source',
      fin.referralFee
    )
  }

  return items
}

// ── Referral-source rollup (per marketing/referral source, across their deals) ──

export interface ReferralSourceCard {
  /** party id, or 'unknown' when a fee exists with no source set. */
  partyId: string
  name: string
  dealCount: number
  owed: number
  paid: number
  projected: number
  total: number
}

/**
 * Total referral fees by marketing/referral source across all non-lost deals.
 * `partyName` resolves source party ids to names.
 */
export function referralSourceRollup(
  rows: DealWithLines[],
  partyName: Map<string, string>
): ReferralSourceCard[] {
  const accel = acceleratorMap(rows, new Date().getFullYear())
  const cards = new Map<string, ReferralSourceCard>()

  for (const row of rows) {
    const { deal } = row
    if (isLostStage(deal.stage)) continue
    const fin = financialsFor(row, accel)
    if (fin.referralFee <= 0) continue

    const id = deal.referral_party_id ?? 'unknown'
    let c = cards.get(id)
    if (!c) {
      c = {
        partyId: id,
        name: deal.referral_party_id ? partyName.get(deal.referral_party_id) ?? 'Unknown contact' : 'No source set',
        dealCount: 0,
        owed: 0,
        paid: 0,
        projected: 0,
        total: 0,
      }
      cards.set(id, c)
    }
    c.dealCount += 1
    c.total += fin.referralFee
    if (!isCommissionPayable(deal.stage)) c.projected += fin.referralFee
    else if (deal.referral_fee_paid) c.paid += fin.referralFee
    else c.owed += fin.referralFee
  }

  return [...cards.values()].sort((a, b) => b.total - a.total)
}
