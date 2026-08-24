/**
 * Agent tools for the modules the original tool set never reached.
 *
 * agent-tools.ts grew up around the projects/opportunities/investors core, so
 * whole surfaces of the app — the steel CRM, the steering board, meeting
 * minutes, the swept mailboxes, the audit log — were invisible to the agent:
 * it would confidently answer "no steel deals" because it had no way to look.
 * These declarations close that gap so "ask Ber AI" spans the whole platform.
 *
 * Kept beside agent-tools.ts rather than inside it purely for size; the two are
 * spliced into one list by `agentTools` and one switch by `executeToolCall`.
 *
 * Read-only by design. Every write in this app goes through a human review
 * step, and the agent is not that step.
 */

import { createAdminClient } from '@/lib/supabase/admin'
// The sweep tables post-date the last type generation (gen-types is disabled
// against the self-hosted DB), so they are reached through the sweep's own
// untyped client rather than the generated Database type.
import { sweepDb } from '@/lib/email-sweep/db'
import {
  STEEL_STAGE_LABELS,
  STEEL_PIPELINE,
  steelStage,
  isLostStage,
  isOpenStage,
  isCommissionPayable,
  STEEL_STAGE_INDEX,
  lineItemLabel,
  formatSqft,
  STEEL_MARKETING_MONTHLY_BUDGET,
} from '@/lib/utils/steel'
import {
  groupServices,
  financialsFor,
  acceleratorMap,
  repScorecards,
  payoutItems,
} from '@/lib/steel/rollups'
import { channelAnalytics, icpBreakdown, spendByMonth } from '@/lib/steel/marketing'
import type { SteelDeal, SteelDealService, SteelMarketingSpend } from '@/lib/supabase/types'

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

export const moduleTools = [
  {
    name: 'list_steel_deals',
    description:
      'List prefab steel deals from the steel CRM (/steel) — a separate pipeline from projects and opportunities. Use for any question about steel deals, the steel pipeline, square footage, steel customers, or which steel deals are open/won/lost. Returns each deal with its stage, customer, value, square footage, salesperson, and margin.',
    parameters: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          description: `Optional stage filter. One of: ${STEEL_PIPELINE.join(', ')}.`,
        },
        open_only: { type: 'boolean', description: 'Only deals still live in the pipeline (excludes won and lost).' },
        customer: { type: 'string', description: 'Optional customer name filter (partial match).' },
        salesperson: { type: 'string', description: 'Optional salesperson name filter (partial match).' },
        limit: { type: 'number', description: 'Max deals to return (default 50).' },
      },
    },
  },
  {
    name: 'query_steel_deal',
    description:
      'Full detail on one steel deal: every line item (description, category, price, cost, margin), the notes history, the referral source, and the complete commission breakdown (sales commission, install fee, referral fee, net to the company). Use when asked about a specific steel deal or its economics.',
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'UUID of the steel deal, when known.' },
        name: { type: 'string', description: 'Deal or customer name to look up (fuzzy match). Use when the UUID is unknown.' },
      },
    },
  },
  {
    name: 'get_steel_summary',
    description:
      'Roll up the whole steel business: pipeline value by stage, won/lost counts and win rate, total revenue, cost, margin, commissions owed vs paid, and per-rep scorecards. Use for "how is steel doing", steel revenue/margin questions, or commission totals.',
    parameters: {
      type: 'object',
      properties: {
        year: { type: 'number', description: 'Calendar year for the accelerator basis and collected totals (default: current year).' },
      },
    },
  },
  {
    name: 'get_steel_payouts',
    description:
      'The steel commission payout worklist — who is owed what, on which deal, and whether it has been paid. Covers sales commissions, installation fees, and referral fees. Use for "what commissions do we owe", "what has been paid", or a specific rep\'s earnings.',
    parameters: {
      type: 'object',
      properties: {
        person: { type: 'string', description: 'Optional: filter to one rep or referral source by name (partial match).' },
        unpaid_only: { type: 'boolean', description: 'Only payouts still owed (default true).' },
      },
    },
  },
  {
    name: 'get_steel_marketing',
    description:
      'Steel marketing performance: spend by channel and month against budget, deals and revenue attributed to each lead source, cost per lead / per won deal, and the ICP segment breakdown. Use for marketing spend, channel ROI, or lead-source questions.',
    parameters: {
      type: 'object',
      properties: {
        months: { type: 'number', description: 'How many recent months of spend to include (default 6).' },
      },
    },
  },
  {
    name: 'list_objectives',
    description:
      'The company steering board (/objectives) — the Now / Soon / Possibly priority buckets that drive the dashboard and daily brief. Use when asked about priorities, focus, what matters now, or company objectives.',
    parameters: {
      type: 'object',
      properties: {
        bucket: { type: 'string', enum: ['now', 'soon', 'possibly'], description: 'Optional bucket filter.' },
        include_done: { type: 'boolean', description: 'Include completed objectives (default false).' },
      },
    },
  },
  {
    name: 'search_meetings',
    description:
      'Search meeting records — minutes, summaries, decisions, and transcripts from project and company meetings. Use when asked what was decided or discussed in a meeting, or for meeting history on a project.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search across title, summary, minutes, and transcript.' },
        project_id: { type: 'string', description: 'Optional: restrict to one project.' },
        limit: { type: 'number', description: 'Max meetings to return (default 10).' },
      },
    },
  },
  {
    name: 'get_meeting_content',
    description:
      'Fetch one meeting in full — attendees, summary, decisions, and the complete minutes or transcript text. Use after search_meetings identifies the meeting you need to quote.',
    parameters: {
      type: 'object',
      properties: { meeting_id: { type: 'string', description: 'UUID of the meeting.' } },
      required: ['meeting_id'],
    },
  },
  {
    name: 'search_email_threads',
    description:
      'Search the swept Gmail correspondence — every thread read from the connected mailboxes, with its AI summary, counterparty, people, key facts, and open items. This is the raw conversation history BEHIND the CRM records. Use to answer "what did we discuss with X", "what did they say about Y", or to find correspondence that has not become a project yet.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match against subject, participants, deal name, and summary.' },
        participant: { type: 'string', description: 'Optional: email address or domain that must appear in the thread.' },
        relevance: {
          type: 'string',
          enum: ['deal', 'operational', 'noise'],
          description: 'Optional triage filter. "deal" = business pursuits, "operational" = running the business, "noise" = newsletters/personal.',
        },
        limit: { type: 'number', description: 'Max threads to return (default 15).' },
      },
    },
  },
  {
    name: 'get_email_thread',
    description:
      'Fetch one email thread in full, including the original message text, so you can quote what was actually written. Use after search_email_threads finds the thread.',
    parameters: {
      type: 'object',
      properties: { thread_id: { type: 'string', description: 'UUID of the email thread.' } },
      required: ['thread_id'],
    },
  },
  {
    name: 'get_intake_status',
    description:
      'Status of the Gmail intake pipeline: how much mail has been read, summarized, grouped into candidate deals, and staged for review, plus what is sitting in the review queue awaiting a human. Use for "is email working", "what is waiting for me to review", or intake backlog questions.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_recent_activity',
    description:
      'The audit log of recent changes across the platform — what record changed, who changed it, and when. Use for "what happened recently", "who changed X", or "what has been updated this week".',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Optional: restrict to one table (e.g. projects, tasks, steel_deals).' },
        project_id: { type: 'string', description: 'Optional: restrict to one project.' },
        days: { type: 'number', description: 'How far back to look (default 14).' },
        limit: { type: 'number', description: 'Max entries (default 40).' },
      },
    },
  },
  {
    name: 'list_team_members',
    description:
      'The internal team — names, roles, whether they are active, and whether they are a steel sales rep. Use to resolve "who is Eric", to list the team, or before attributing tasks and commissions to a person.',
    parameters: {
      type: 'object',
      properties: { include_inactive: { type: 'boolean', description: 'Include deactivated members (default false).' } },
    },
  },
  {
    name: 'get_dino_summary',
    description:
      'The Dino side venture ledger — revenue entries by source, scheduled payments and what is still due, and notes. Use only for questions naming Dino.',
    parameters: { type: 'object', properties: {} },
  },
]

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Names handled here, so executeToolCall can route without a second switch. */
export const MODULE_TOOL_NAMES = new Set(moduleTools.map((t) => t.name))

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const money = (n: number): number => Math.round(n * 100) / 100

/** Load every steel deal with its line items — the basis for all steel rollups. */
async function loadSteelRows() {
  const supabase = createAdminClient()
  const [{ data: deals }, { data: services }, { data: members }] = await Promise.all([
    supabase.from('steel_deals').select('*'),
    supabase.from('steel_deal_services').select('*'),
    supabase.from('team_members').select('id, name'),
  ])
  return {
    deals: (deals ?? []) as SteelDeal[],
    services: (services ?? []) as SteelDealService[],
    members: (members ?? []) as { id: string; name: string }[],
    rows: groupServices((deals ?? []) as SteelDeal[], (services ?? []) as SteelDealService[]),
  }
}

export async function executeModuleTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const supabase = createAdminClient()

  switch (toolName) {
    // ── Steel ────────────────────────────────────────────────────────────────
    case 'list_steel_deals': {
      const { rows, members } = await loadSteelRows()
      const accel = acceleratorMap(rows, new Date().getFullYear())
      const memberName = new Map(members.map((m) => [m.id, m.name]))

      const stage = str(args.stage)
      const customer = str(args.customer)?.toLowerCase()
      const salesperson = str(args.salesperson)?.toLowerCase()
      const limit = num(args.limit) ?? 50

      const filtered = rows.filter(({ deal }) => {
        if (stage && steelStage(deal.stage) !== steelStage(stage)) return false
        if (args.open_only === true && !isOpenStage(deal.stage)) return false
        if (customer && !(deal.customer ?? '').toLowerCase().includes(customer)) return false
        if (salesperson) {
          const who = (memberName.get(deal.salesperson_id ?? '') ?? '').toLowerCase()
          if (!who.includes(salesperson)) return false
        }
        return true
      })

      return {
        count: filtered.length,
        deals: filtered.slice(0, limit).map((row) => {
          const fin = financialsFor(row, accel)
          const { deal } = row
          return {
            id: deal.id,
            name: deal.name,
            customer: deal.customer,
            stage: STEEL_STAGE_LABELS[steelStage(deal.stage)],
            building_type: deal.building_type,
            square_feet: deal.square_feet,
            square_feet_display: formatSqft(deal.square_feet),
            value: deal.value,
            revenue: money(fin.revenue),
            margin: money(fin.margin),
            salesperson: memberName.get(deal.salesperson_id ?? '') ?? null,
            lead_source: deal.lead_source,
            next_step: deal.next_step,
            next_step_date: deal.next_step_date,
            expected_delivery_date: deal.expected_delivery_date,
            is_open: isOpenStage(deal.stage),
            is_lost: isLostStage(deal.stage),
          }
        }),
        note: filtered.length > limit ? `Showing ${limit} of ${filtered.length}.` : undefined,
      }
    }

    case 'query_steel_deal': {
      const { rows, members } = await loadSteelRows()
      const accel = acceleratorMap(rows, new Date().getFullYear())
      const memberName = new Map(members.map((m) => [m.id, m.name]))

      const dealId = str(args.deal_id)
      const name = str(args.name)?.toLowerCase()
      const row =
        (dealId && rows.find((r) => r.deal.id === dealId)) ||
        (name &&
          rows.find(
            (r) =>
              (r.deal.name ?? '').toLowerCase().includes(name) ||
              (r.deal.customer ?? '').toLowerCase().includes(name)
          ))
      if (!row) return { error: `No steel deal matched ${dealId ?? name ?? '(no identifier given)'}.` }

      const { deal, lines } = row
      const fin = financialsFor(row, accel)

      const [{ data: notes }, { data: referral }] = await Promise.all([
        supabase
          .from('steel_deal_notes')
          .select('body, author, created_at')
          .eq('deal_id', deal.id)
          .order('created_at', { ascending: false })
          .limit(20),
        deal.referral_party_id
          ? supabase.from('parties').select('full_name').eq('id', deal.referral_party_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      return {
        id: deal.id,
        name: deal.name,
        customer: deal.customer,
        stage: STEEL_STAGE_LABELS[steelStage(deal.stage)],
        building_type: deal.building_type,
        square_feet: deal.square_feet,
        price_per_sqft: deal.price_per_sqft,
        pricing_below_floor: deal.pricing_below_floor,
        description: deal.description,
        salesperson: memberName.get(deal.salesperson_id ?? '') ?? null,
        marketer: memberName.get(deal.marketer_id ?? '') ?? null,
        lead_source: deal.lead_source,
        lead_source_detail: deal.lead_source_detail,
        referral_source: (referral as { full_name: string } | null)?.full_name ?? null,
        icp_segment: deal.icp_segment,
        buying_trigger: deal.buying_trigger,
        next_step: deal.next_step,
        next_step_date: deal.next_step_date,
        expected_delivery_date: deal.expected_delivery_date,
        collected_date: deal.collected_date,
        line_items: lines.map((l) => ({
          description: lineItemLabel(l.service_type, l.description),
          category: l.service_type,
          price: l.price,
          cost: l.cost,
          margin: money((l.price ?? 0) - (l.cost ?? 0)),
          commissionable: l.commissionable,
        })),
        financials: {
          revenue: money(fin.revenue),
          cost: money(fin.cost),
          margin: money(fin.margin),
          commissionable_margin: money(fin.commissionableMargin),
          sales_rate_pct: fin.salesRate,
          sales_commission: money(fin.salesCommission),
          install_fee: money(fin.installFee),
          referral_fee: money(fin.referralFee),
          total_payout: money(fin.totalPayout),
          net_to_company: money(fin.net),
          commission_payable_now: isCommissionPayable(deal.stage),
        },
        payment_status: {
          sales_commission_paid: deal.sales_commission_paid,
          install_fee_paid: deal.install_fee_paid,
          referral_fee_paid: deal.referral_fee_paid,
        },
        notes: notes ?? [],
      }
    }

    case 'get_steel_summary': {
      const year = num(args.year) ?? new Date().getFullYear()
      const { rows, members } = await loadSteelRows()
      const accel = acceleratorMap(rows, year)

      const byStage: Record<string, { count: number; revenue: number; margin: number }> = {}
      // "Won" here means the customer committed — order placed or beyond — which
      // is the definition the marketing analytics use. It is NOT the same as
      // "collected" (Paid), and a won deal is no longer in pursuit. Keeping the
      // three separate stops the summary from reporting a deal as both open and
      // won, which two different in-app definitions of "open" would otherwise do.
      let inPursuit = 0
      let won = 0
      let collected = 0
      let lost = 0
      const totals = { revenue: 0, cost: 0, margin: 0, payout: 0, net: 0 }

      for (const row of rows) {
        const fin = financialsFor(row, accel)
        const stage = steelStage(row.deal.stage)
        const label = STEEL_STAGE_LABELS[stage]
        const bucket = (byStage[label] ??= { count: 0, revenue: 0, margin: 0 })
        bucket.count++
        bucket.revenue = money(bucket.revenue + fin.revenue)
        bucket.margin = money(bucket.margin + fin.margin)

        if (isLostStage(row.deal.stage)) {
          lost++
        } else {
          if (STEEL_STAGE_INDEX[stage] >= STEEL_STAGE_INDEX.order_placed) won++
          else inPursuit++
          if (isCommissionPayable(row.deal.stage)) collected++

          totals.revenue += fin.revenue
          totals.cost += fin.cost
          totals.margin += fin.margin
          totals.payout += fin.totalPayout
          totals.net += fin.net
        }
      }

      const scorecards = repScorecards(rows, members, year)

      return {
        year,
        deal_count: rows.length,
        in_pursuit: inPursuit,
        won,
        collected,
        lost,
        win_rate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) / 100 : null,
        by_stage: byStage,
        definitions:
          'in_pursuit = quote or engineering; won = order placed or beyond (customer committed); ' +
          'collected = reached Paid (cash in, commissions become owed); lost = dead. ' +
          'A won deal is counted once in "won" and, if it has been paid, again in "collected".',
        totals: {
          revenue: money(totals.revenue),
          cost: money(totals.cost),
          margin: money(totals.margin),
          total_commissions_and_fees: money(totals.payout),
          net_to_company: money(totals.net),
          note: 'Totals exclude lost deals.',
        },
        reps: scorecards.map((s) => ({
          name: s.name,
          deals: s.dealCount,
          sales: money(s.totalSales),
          profit_generated: money(s.totalProfit),
          collected_profit_ytd: money(s.collectedProfitYTD),
          accelerated: s.accelerated,
          owed: money(s.totalOwed),
          paid: money(s.totalPaid),
          projected: money(s.totalProjected),
        })),
      }
    }

    case 'get_steel_payouts': {
      const { rows, members } = await loadSteelRows()
      const { data: parties } = await supabase.from('parties').select('id, full_name')
      const partyName = new Map(
        ((parties ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
      )
      const items = payoutItems(rows, members, partyName)

      const person = str(args.person)?.toLowerCase()
      const unpaidOnly = args.unpaid_only !== false

      const filtered = items.filter((i) => {
        if (unpaidOnly && i.paid) return false
        if (person && !i.personName.toLowerCase().includes(person)) return false
        return true
      })

      return {
        count: filtered.length,
        total_owed: money(filtered.filter((i) => !i.paid).reduce((a, i) => a + i.amount, 0)),
        total_paid: money(items.filter((i) => i.paid).reduce((a, i) => a + i.amount, 0)),
        payouts: filtered.map((i) => ({
          deal: i.dealName,
          deal_id: i.dealId,
          kind: i.kind,
          person: i.personName,
          amount: money(i.amount),
          paid: i.paid,
        })),
        note: 'Commissions become payable only once a deal is collected (Paid stage); anything earlier is projected.',
      }
    }

    case 'get_steel_marketing': {
      const { deals, services } = await loadSteelRows()
      const { data: spendRows } = await supabase.from('steel_marketing_spend').select('*')
      const spend = (spendRows ?? []) as SteelMarketingSpend[]

      const analytics = channelAnalytics(deals, services, spend)
      const months = spendByMonth(spend, STEEL_MARKETING_MONTHLY_BUDGET, num(args.months) ?? 6)

      return {
        monthly_budget: STEEL_MARKETING_MONTHLY_BUDGET,
        spend_by_month: months,
        channels: analytics.channels.map((c) => ({
          channel: c.channel,
          leads: c.leads,
          won: c.won,
          lost: c.lost,
          open: c.open,
          win_rate: c.winRate,
          won_revenue: money(c.wonRevenue),
          won_margin: money(c.wonMargin),
          spend: money(c.spend),
          cost_per_won_deal: c.cac != null ? money(c.cac) : null,
          return_on_spend: c.roas,
          margin_return_on_spend: c.roasMargin,
        })),
        totals: {
          leads: analytics.totals.leads,
          won: analytics.totals.won,
          spend: money(analytics.totals.spend),
          won_revenue: money(analytics.totals.wonRevenue),
          won_margin: money(analytics.totals.wonMargin),
        },
        by_icp_segment: icpBreakdown(deals, services, 'icp_segment'),
        by_buying_trigger: icpBreakdown(deals, services, 'buying_trigger'),
      }
    }

    // ── Objectives ───────────────────────────────────────────────────────────
    case 'list_objectives': {
      let q = supabase
        .from('objectives')
        .select('id, title, note, bucket, status, health, target_date, owner_id, sort_order')
        .order('bucket')
        .order('sort_order')

      const bucket = str(args.bucket)
      if (bucket) q = q.eq('bucket', bucket)
      if (args.include_done !== true) q = q.neq('status', 'done')

      const { data, error } = await q
      if (error) return { error: `Objectives lookup failed: ${error.message}` }

      const { data: members } = await supabase.from('team_members').select('id, name')
      const owner = new Map(
        ((members ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name])
      )

      return {
        count: data?.length ?? 0,
        objectives: (data ?? []).map((o) => ({
          id: o.id,
          title: o.title,
          note: o.note,
          bucket: o.bucket,
          status: o.status,
          health: o.health,
          target_date: o.target_date,
          owner: owner.get(o.owner_id ?? '') ?? null,
        })),
        note: 'Buckets are the steering board: "now" is active focus, "soon" is queued, "possibly" is parked.',
      }
    }

    // ── Meetings ─────────────────────────────────────────────────────────────
    case 'search_meetings': {
      const limit = num(args.limit) ?? 10
      let q = supabase
        .from('meetings')
        .select('id, title, kind, scope, project_id, meeting_date, location, summary, decisions, status, confidential')
        .order('meeting_date', { ascending: false })
        .limit(limit)

      const projectId = str(args.project_id)
      if (projectId) q = q.eq('project_id', projectId)

      const query = str(args.query)
      if (query) {
        const like = `%${query}%`
        q = q.or(`title.ilike.${like},summary.ilike.${like},minutes.ilike.${like},transcript.ilike.${like}`)
      }

      const { data, error } = await q
      if (error) return { error: `Meeting search failed: ${error.message}` }

      // Confidential minutes are listed but never summarized into an answer.
      return {
        count: data?.length ?? 0,
        meetings: (data ?? []).map((m) => ({
          id: m.id,
          title: m.title,
          kind: m.kind,
          scope: m.scope,
          project_id: m.project_id,
          date: m.meeting_date,
          location: m.location,
          status: m.status,
          summary: m.confidential ? null : m.summary,
          decisions: m.confidential ? null : m.decisions,
          confidential: m.confidential,
        })),
      }
    }

    case 'get_meeting_content': {
      const id = str(args.meeting_id)
      if (!id) return { error: 'meeting_id is required.' }

      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) return { error: `Meeting lookup failed: ${error.message}` }
      if (!data) return { error: `Meeting not found: ${id}` }
      if (data.confidential) {
        return {
          id: data.id,
          title: data.title,
          date: data.meeting_date,
          confidential: true,
          error: 'This meeting is marked confidential; its contents are not available to the assistant.',
        }
      }

      const body = data.minutes ?? data.transcript ?? ''
      return {
        id: data.id,
        title: data.title,
        kind: data.kind,
        date: data.meeting_date,
        time: data.meeting_time,
        location: data.location,
        chair: data.chair,
        secretary: data.secretary,
        attendees: data.attendees,
        summary: data.summary,
        decisions: data.decisions,
        status: data.status,
        content: body.slice(0, 20000) || null,
        truncated: body.length > 20000,
        source: data.minutes ? 'minutes' : data.transcript ? 'transcript' : null,
      }
    }

    // ── Email intake ─────────────────────────────────────────────────────────
    case 'search_email_threads': {
      const limit = num(args.limit) ?? 15
      let q = sweepDb()
        .from('email_threads')
        .select('id, subject, participants, mailbox, first_at, last_at, message_count, attachment_count, summary, cluster_id')
        .eq('summary_state', 'summarized')
        .order('last_at', { ascending: false })
        .limit(limit)

      const query = str(args.query)
      if (query) {
        const like = `%${query}%`
        // summary is jsonb; ::text lets one ilike cover deal name, counterparty,
        // key facts and the narrative without a column-per-field OR chain.
        q = q.or(`subject.ilike.${like},summary::text.ilike.${like}`)
      }
      const participant = str(args.participant)
      if (participant) q = q.filter('participants', 'cs', `{${participant}}`)
      const relevance = str(args.relevance)
      if (relevance) q = q.filter('summary->>relevance', 'eq', relevance)

      const { data, error } = await q
      if (error) return { error: `Email search failed: ${error.message}` }

      type Summary = {
        relevance?: string
        deal_name?: string | null
        counterparty?: string | null
        summary?: string | null
        key_facts?: string[]
        open_items?: string[]
        people?: { name?: string; email?: string; company?: string }[]
        estimated_value?: string | number | null
        location?: string | null
      }

      return {
        count: data?.length ?? 0,
        threads: (data ?? []).map((t) => {
          const s = (t.summary ?? {}) as Summary
          return {
            id: t.id,
            subject: t.subject,
            mailbox: t.mailbox,
            participants: t.participants,
            first_at: t.first_at,
            last_at: t.last_at,
            message_count: t.message_count,
            attachment_count: t.attachment_count,
            relevance: s.relevance ?? null,
            deal_name: s.deal_name ?? null,
            counterparty: s.counterparty ?? null,
            location: s.location ?? null,
            estimated_value: s.estimated_value ?? null,
            summary: s.summary ?? null,
            key_facts: s.key_facts ?? [],
            open_items: s.open_items ?? [],
            people: s.people ?? [],
            grouped_into_deal: !!t.cluster_id,
          }
        }),
        note: 'Use get_email_thread with an id to read the original message text.',
      }
    }

    case 'get_email_thread': {
      const id = str(args.thread_id)
      if (!id) return { error: 'thread_id is required.' }

      const { data, error } = await sweepDb()
        .from('email_threads')
        .select('id, subject, mailbox, participants, first_at, last_at, message_count, attachment_count, summary, raw_markdown')
        .eq('id', id)
        .maybeSingle()
      if (error) return { error: `Thread lookup failed: ${error.message}` }
      if (!data) return { error: `Email thread not found: ${id}` }

      const raw = data.raw_markdown ?? ''
      return {
        id: data.id,
        subject: data.subject,
        mailbox: data.mailbox,
        participants: data.participants,
        first_at: data.first_at,
        last_at: data.last_at,
        message_count: data.message_count,
        attachment_count: data.attachment_count,
        summary: data.summary,
        content: raw.slice(0, 25000),
        truncated: raw.length > 25000,
      }
    }

    case 'get_intake_status': {
      const [sync, threadStates, clusters, sessions, review] = await Promise.all([
        sweepDb().from('mailbox_sync').select('mailbox, state, threads_seen, threads_new, last_error, completed_at'),
        sweepDb().from('email_threads').select('summary_state'),
        sweepDb().from('thread_clusters').select('state'),
        supabase.from('email_intake_sessions').select('status'),
        supabase.from('review_queue').select('reason, resolution').is('resolved_at', null),
      ])

      const tally = <T extends Record<string, unknown>>(rows: T[] | null, key: keyof T) => {
        const out: Record<string, number> = {}
        for (const r of rows ?? []) {
          const k = String(r[key] ?? 'unknown')
          out[k] = (out[k] ?? 0) + 1
        }
        return out
      }

      return {
        mailboxes: sync.data ?? [],
        threads_by_state: tally(threadStates.data, 'summary_state'),
        candidate_deals_by_state: tally(clusters.data, 'state'),
        intake_sessions_by_status: tally(sessions.data, 'status'),
        review_queue_open: review.data?.length ?? 0,
        review_reasons: tally(review.data, 'reason'),
        note: 'Threads move pending → summarized, then group into candidate deals, then stage as pending intake sessions for a human to confirm. Nothing reaches the CRM without that confirmation.',
      }
    }

    // ── Activity / team ──────────────────────────────────────────────────────
    case 'get_recent_activity': {
      const days = num(args.days) ?? 14
      const since = new Date(Date.now() - days * 86_400_000).toISOString()
      let q = supabase
        .from('activity_log')
        .select('action, table_name, record_id, project_id, actor_email, actor_type, metadata, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(num(args.limit) ?? 40)

      const table = str(args.table)
      if (table) q = q.eq('table_name', table)
      const projectId = str(args.project_id)
      if (projectId) q = q.eq('project_id', projectId)

      const { data, error } = await q
      if (error) return { error: `Activity lookup failed: ${error.message}` }

      return {
        since,
        count: data?.length ?? 0,
        entries: (data ?? []).map((a) => ({
          when: a.created_at,
          action: a.action,
          table: a.table_name,
          record_id: a.record_id,
          project_id: a.project_id,
          actor: a.actor_email ?? a.actor_type,
          detail: a.metadata,
        })),
      }
    }

    case 'list_team_members': {
      let q = supabase
        .from('team_members')
        .select('id, name, email, role, active, is_steel_rep')
        .order('name')
      if (args.include_inactive !== true) q = q.eq('active', true)

      const { data, error } = await q
      if (error) return { error: `Team lookup failed: ${error.message}` }
      return { count: data?.length ?? 0, members: data ?? [] }
    }

    // ── Dino ─────────────────────────────────────────────────────────────────
    case 'get_dino_summary': {
      const [revenue, payments, notes] = await Promise.all([
        supabase
          .from('dino_revenue')
          .select('source_type, client_name, description, amount, revenue_date')
          .order('revenue_date', { ascending: false })
          .limit(100),
        supabase.from('dino_payments').select('label, amount, due_date, paid, paid_date').order('due_date'),
        supabase.from('dino_notes').select('body, author, created_at').order('created_at', { ascending: false }).limit(10),
      ])

      const rev = revenue.data ?? []
      const pay = payments.data ?? []
      const bySource: Record<string, number> = {}
      for (const r of rev) {
        const k = r.source_type ?? 'unspecified'
        bySource[k] = money((bySource[k] ?? 0) + (r.amount ?? 0))
      }

      return {
        total_revenue: money(rev.reduce((a, r) => a + (r.amount ?? 0), 0)),
        revenue_by_source: bySource,
        recent_revenue: rev.slice(0, 20),
        payments_due: money(pay.filter((p) => !p.paid).reduce((a, p) => a + (p.amount ?? 0), 0)),
        payments_paid: money(pay.filter((p) => p.paid).reduce((a, p) => a + (p.amount ?? 0), 0)),
        payments: pay,
        notes: notes.data ?? [],
      }
    }

    default:
      return { error: `Unknown module tool: ${toolName}` }
  }
}
