/**
 * Steel marketing analytics — lead-source conversion, spend vs budget, CAC/ROAS,
 * and ICP breakdowns. Pure functions over deals + services + the spend ledger.
 *
 * "Won" = the customer committed (order placed or beyond), distinct from
 * "collected" (Paid). Quote/Engineering are still in-pursuit (open).
 */

import type { SteelDeal, SteelDealService, SteelMarketingSpend } from '@/lib/supabase/types'
import {
  isLostStage,
  leadSourceLabel,
  servicesRevenue,
  STEEL_STAGE_INDEX,
  steelStage,
} from '@/lib/utils/steel'
import { groupServices, type DealWithLines } from './rollups'

/** A deal is "won" for marketing once the order is placed (index ≥ 2). */
function isWon(stage: string): boolean {
  return !isLostStage(stage) && STEEL_STAGE_INDEX[steelStage(stage)] >= STEEL_STAGE_INDEX.order_placed
}
/** Still being pursued — quote / engineering. */
function isOpen(stage: string): boolean {
  return !isLostStage(stage) && !isWon(stage)
}

function revenueMargin(row: DealWithLines): { revenue: number; margin: number } {
  const revenue = row.deal.value ?? servicesRevenue(row.lines)
  const cost = row.lines.reduce((a, s) => a + (s.cost ?? 0), 0)
  return { revenue, margin: revenue - cost }
}

export interface ChannelStat {
  channel: string
  leads: number
  won: number
  lost: number
  open: number
  /** won / (won + lost); null when nothing has closed either way. */
  winRate: number | null
  wonRevenue: number
  wonMargin: number
  wonSqft: number
  avgPricePerSqft: number | null
  spend: number
  /** spend / won deals. */
  cac: number | null
  /** won revenue / spend. */
  roas: number | null
  /** won margin / spend. */
  roasMargin: number | null
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null)

export interface ChannelAnalytics {
  channels: ChannelStat[]
  totals: ChannelStat
}

export function channelAnalytics(
  deals: SteelDeal[],
  services: SteelDealService[],
  spend: SteelMarketingSpend[]
): ChannelAnalytics {
  const rows = groupServices(deals, services)
  const stats = new Map<string, ChannelStat>()
  const ensure = (channel: string): ChannelStat => {
    let s = stats.get(channel)
    if (!s) {
      s = {
        channel,
        leads: 0,
        won: 0,
        lost: 0,
        open: 0,
        winRate: null,
        wonRevenue: 0,
        wonMargin: 0,
        wonSqft: 0,
        avgPricePerSqft: null,
        spend: 0,
        cac: null,
        roas: null,
        roasMargin: null,
      }
      stats.set(channel, s)
    }
    return s
  }

  for (const row of rows) {
    const { deal } = row
    const s = ensure(leadSourceLabel(deal.lead_source))
    s.leads += 1
    if (isLostStage(deal.stage)) s.lost += 1
    else if (isWon(deal.stage)) {
      s.won += 1
      const { revenue, margin } = revenueMargin(row)
      s.wonRevenue += revenue
      s.wonMargin += margin
      s.wonSqft += deal.square_feet ?? 0
    } else s.open += 1
  }

  for (const row of spend) {
    ensure(leadSourceLabel(row.channel)).spend += row.amount ?? 0
  }

  // Derive rates.
  for (const s of stats.values()) {
    const closed = s.won + s.lost
    s.winRate = closed > 0 ? s.won / closed : null
    s.avgPricePerSqft = div(s.wonRevenue, s.wonSqft)
    s.cac = div(s.spend, s.won)
    s.roas = div(s.wonRevenue, s.spend)
    s.roasMargin = div(s.wonMargin, s.spend)
  }

  const channels = [...stats.values()].sort((a, b) => b.wonRevenue - a.wonRevenue || b.leads - a.leads)

  // Totals row.
  const totals: ChannelStat = {
    channel: 'All channels',
    leads: 0,
    won: 0,
    lost: 0,
    open: 0,
    winRate: null,
    wonRevenue: 0,
    wonMargin: 0,
    wonSqft: 0,
    avgPricePerSqft: null,
    spend: 0,
    cac: null,
    roas: null,
    roasMargin: null,
  }
  for (const s of channels) {
    totals.leads += s.leads
    totals.won += s.won
    totals.lost += s.lost
    totals.open += s.open
    totals.wonRevenue += s.wonRevenue
    totals.wonMargin += s.wonMargin
    totals.wonSqft += s.wonSqft
    totals.spend += s.spend
  }
  const closedT = totals.won + totals.lost
  totals.winRate = closedT > 0 ? totals.won / closedT : null
  totals.avgPricePerSqft = div(totals.wonRevenue, totals.wonSqft)
  totals.cac = div(totals.spend, totals.won)
  totals.roas = div(totals.wonRevenue, totals.spend)
  totals.roasMargin = div(totals.wonMargin, totals.spend)

  return { channels, totals }
}

// ── ICP breakdown ──

export interface IcpStat {
  key: string
  leads: number
  won: number
  wonRevenue: number
  winRate: number | null
}

export function icpBreakdown(
  deals: SteelDeal[],
  services: SteelDealService[],
  field: 'icp_segment' | 'buying_trigger'
): IcpStat[] {
  const rows = groupServices(deals, services)
  const map = new Map<string, IcpStat>()
  for (const row of rows) {
    const { deal } = row
    const key = (deal[field] ?? '').trim() || 'Unspecified'
    let s = map.get(key)
    if (!s) {
      s = { key, leads: 0, won: 0, wonRevenue: 0, winRate: null }
      map.set(key, s)
    }
    s.leads += 1
    if (isWon(deal.stage)) {
      s.won += 1
      s.wonRevenue += revenueMargin(row).revenue
    }
  }
  const list = [...map.values()]
  for (const s of list) s.winRate = s.leads > 0 ? s.won / s.leads : null
  return list.sort((a, b) => b.wonRevenue - a.wonRevenue || b.leads - a.leads)
}

// ── Spend vs budget by month ──

export interface MonthSpend {
  month: string // 'YYYY-MM'
  label: string // 'Aug 2026'
  spend: number
  budget: number
}

/** Last `count` calendar months (oldest→newest) with spend summed and the budget line. */
export function spendByMonth(spend: SteelMarketingSpend[], budget: number, count = 6): MonthSpend[] {
  const byMonth = new Map<string, number>()
  for (const r of spend) {
    const key = (r.spend_month ?? '').slice(0, 7)
    if (!key) continue
    byMonth.set(key, (byMonth.get(key) ?? 0) + (r.amount ?? 0))
  }
  const out: MonthSpend[] = []
  const now = new Date()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({
      month: key,
      label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      spend: byMonth.get(key) ?? 0,
      budget,
    })
  }
  return out
}

export const isWonStage = isWon
export const isOpenStage = isOpen
