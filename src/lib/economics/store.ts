/**
 * Loading and saving a deal's economics model.
 *
 * The engine is pure and knows nothing about Postgres; this is the only place
 * that maps between the two. Everything it loads goes through
 * `computeDealEconomics`, so the tab, the scratchpad, the API route and the
 * agent tools cannot disagree about a number.
 *
 * ⚠ `numeric` COMES BACK FROM POSTGREST AS A STRING OFTEN ENOUGH THAT TRUSTING
 * IT IS A BUG WAITING FOR A LARGE VALUE, so every figure goes through `num()`,
 * which answers null rather than 0 for anything unreadable. Null means "nobody
 * has said" everywhere in this feature and 0 is a real price.
 *
 * Not re-exported from index.ts: the engine stays loadable with no database.
 */

import {
  calcDb,
  calcDbAs,
  num,
  numArray,
  type BucketRow,
  type CapacitySourceRow,
  type DealEconomicsRow,
  type LineRow,
  type ProvenanceRow,
  type ScheduleRow,
} from './db'
import { RECORD_SCOPE_COLUMN, type RecordKind } from '@/lib/records/scope'
import { resolveBwShare } from '@/lib/spvs/ownership'
import { loadProjectSpvs } from '@/lib/spvs/queries'
import type { ProjectSpv } from '@/lib/spvs/types'
import { computeDealEconomics, type DealEconomicsResult } from './compute'
import { isProvenanceStatus, type Provenance, type ProvenanceStatus } from './provenance'
import {
  DEFAULT_BUCKETS,
  type CapacityBucket,
  type CapacitySource,
  type DealEconomicsInput,
  type MoneyShape,
  type RevenueLine,
  type ScheduleEntry,
  type Spv,
} from './types'

/**
 * `RecordKind` and the scope column come from src/lib/records/scope.ts, which
 * already defines them for every shared child table in the app.
 *
 * ⚠ THIS FILE ONCE DECLARED ITS OWN COPY OF BOTH, which is the drift that
 * module exists to prevent: its header says a component or route must not be
 * able to invent a third spelling, and a second copy here was exactly that.
 */
export type { RecordKind } from '@/lib/records/scope'

export interface LoadedEconomics {
  economicsId: string
  input: DealEconomicsInput
  /** What was computed and stored last time, for comparison after a save. */
  storedAt: string | null
  notes: string | null
}

function status(value: unknown): ProvenanceStatus {
  return isProvenanceStatus(value) ? value : 'planning_assumption'
}

function toSource(row: CapacitySourceRow): CapacitySource {
  return {
    id: row.id,
    label: row.label,
    kind:
      row.kind === 'onsite_generation' || row.kind === 'storage'
        ? row.kind
        : 'grid_interconnect',
    nameplateMw: num(row.nameplate_mw),
    availabilityPct: num(row.availability_pct),
    blockCount: num(row.block_count),
    redundantBlocks: num(row.redundant_blocks),
    blockMw: num(row.block_mw),
    statedNetMw: num(row.stated_net_mw),
    status: status(row.status),
  }
}

function toBucket(row: BucketRow): CapacityBucket {
  return {
    id: row.id,
    label: row.label,
    priority: num(row.priority) ?? 100,
    peakMw: num(row.peak_mw),
  }
}

/**
 * The engine's view of a vehicle.
 *
 * ⚠ `bwOwnershipPct` IS DERIVED, NOT READ. `resolveBwShare` prefers the
 * participant ledger and falls back to the figure typed on the vehicle, so the
 * engine keeps taking exactly one number and `ownershipWeight` is untouched —
 * but there is now ONE definition of that number, in src/lib/spvs/ownership.ts,
 * rather than a column the ledger silently disagrees with.
 *
 * A null still means "not yet determined" and is held OUT of the net figures,
 * never folded in as 100%.
 */
function toSpv(spv: ProjectSpv): Spv {
  return {
    id: spv.id,
    label: spv.label,
    purpose: spv.purpose,
    entityId: spv.entityId,
    bwOwnershipPct: resolveBwShare(spv, spv.participants).pct,
    status: spv.status,
  }
}

function toProvenance(row: ProvenanceRow): Provenance {
  return {
    status: status(row.status),
    source: row.source,
    sourceRef: row.source_ref,
    asOf: row.as_of,
    note: row.note,
  }
}

function toSchedule(rows: ScheduleRow[]): ScheduleEntry[] | null {
  if (rows.length === 0) return null
  return rows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({
      label: r.label,
      pct: num(r.pct) ?? 0,
      date: r.due_date,
      monthsFromNtp: num(r.months_from_ntp),
    }))
}

/**
 * One row to one engine line.
 *
 * Every type reads from the same sparse column set, which is why the columns
 * are typed rather than a jsonb blob: a price has to be readable by SQL for an
 * export, a rollup or a question nobody has thought of yet.
 */
function toLine(
  row: LineRow,
  schedule: ScheduleEntry[] | null,
  fields: Record<string, Provenance> | undefined
): RevenueLine | null {
  const base = {
    id: row.id,
    label: row.label,
    spvId: row.spv_id,
    isBerWilsonRevenue: row.is_ber_wilson_revenue,
    status: status(row.status),
    fields,
    notes: row.notes,
    costs: {
      opexAnnual: num(row.opex_annual),
      fixedOmPerKwYear: num(row.fixed_om_per_kw_year),
      variableOmPerMwh: num(row.variable_om_per_mwh),
      fuel:
        row.heat_rate == null && row.gas_price_per_mmbtu == null
          ? null
          : { heatRate: num(row.heat_rate), gasPricePerMmbtu: num(row.gas_price_per_mmbtu) },
    },
  }
  const recurring = {
    startYear: num(row.start_year),
    termYears: num(row.term_years),
    escalatorPct: num(row.escalator_pct),
    ramp: numArray(row.ramp),
  }
  const oneTime = {
    schedule,
    countsTowardProjectValue: row.counts_toward_project_value,
  }

  switch (row.line_type) {
    case 'energy_sale':
      return {
        ...base,
        ...recurring,
        type: 'energy_sale',
        bucketId: row.bucket_id,
        mode: row.mode === 'reverse' ? 'reverse' : 'forward',
        mw: num(row.mw),
        loadFactor: num(row.load_factor),
        price: num(row.price),
        priceUnit: row.price_unit === 'per_mwh' ? 'per_mwh' : 'per_kwh',
        targetAnnualRevenue: num(row.amount),
        minimumTakePct: num(row.minimum_take_pct),
      }
    case 'capacity_charge':
      return {
        ...base,
        ...recurring,
        type: 'capacity_charge',
        bucketId: row.bucket_id,
        mw: num(row.mw),
        price: num(row.price),
        priceUnit:
          row.price_unit === 'per_kw_year' || row.price_unit === 'per_mw_year'
            ? row.price_unit
            : 'per_kw_month',
      }
    case 'om_service':
      return {
        ...base,
        ...recurring,
        type: 'om_service',
        mw: num(row.mw),
        price: num(row.price),
        priceUnit:
          row.price_unit === 'per_kw_month' || row.price_unit === 'per_mw_year'
            ? row.price_unit
            : 'per_kw_year',
        counterparty: row.counterparty,
      }
    case 'dc_lease':
      return {
        ...base,
        ...recurring,
        type: 'dc_lease',
        bucketId: row.bucket_id,
        itMw: num(row.it_mw),
        ratePerKwMonth: num(row.rate_per_kw_month),
        occupancy: num(row.occupancy),
        pue: num(row.pue),
        powerPassedThrough: row.power_passed_through,
        powerRevenueRetained: row.power_revenue_retained,
      }
    case 'subscription':
      return {
        ...base,
        ...recurring,
        type: 'subscription',
        bucketId: row.bucket_id,
        units: num(row.units),
        pricePerUnitMonth: num(row.price_per_unit_month),
        unitLabel: row.unit_label,
        mw: num(row.mw),
      }
    case 'energy_attribute':
      return {
        ...base,
        ...recurring,
        type: 'energy_attribute',
        ridesOnLineId: row.rides_on_line_id,
        pricePerMwh: num(row.price_per_mwh),
        attributeKind: row.attribute_kind,
      }
    case 'recurring_fee_on_line':
      return {
        ...base,
        ...recurring,
        type: 'recurring_fee_on_line',
        referencedLineId: row.referenced_line_id,
        base:
          row.fee_base === 'referenced_line_annual_revenue' || row.fee_base === 'capital_base'
            ? row.fee_base
            : 'referenced_line_value',
        capitalBase: num(row.capital_base),
        annualRatePct: num(row.annual_rate_pct),
        ourSharePct: num(row.our_share_pct),
        partnerLabel: row.partner_label,
        isCarveOut: row.is_carve_out,
      }
    case 'one_time_per_mw':
      return {
        ...base,
        ...oneTime,
        type: 'one_time_per_mw',
        mw: num(row.mw),
        pricePerMw: num(row.price_per_mw),
        costPerMw: num(row.cost_per_mw),
      }
    case 'one_time_per_unit':
      return {
        ...base,
        ...oneTime,
        type: 'one_time_per_unit',
        quantity: num(row.quantity),
        pricePerUnit: num(row.price_per_unit),
        costPerUnit: num(row.cost_per_unit),
        unitLabel: row.unit_label,
      }
    case 'one_time_lump':
      return {
        ...base,
        ...oneTime,
        type: 'one_time_lump',
        amount: num(row.amount),
        cost: num(row.cost),
      }
    case 'tax_credit':
      return {
        ...base,
        ...oneTime,
        type: 'tax_credit',
        amount: num(row.amount),
        kind:
          row.credit_kind === '48E' || row.credit_kind === '45X' || row.credit_kind === '45Q'
            ? row.credit_kind
            : 'other',
        transferable: row.transferable,
        ourSharePct: num(row.our_share_pct),
      }
    case 'land':
      return {
        ...base,
        ...oneTime,
        type: 'land',
        disposition: row.disposition === 'lease' ? 'lease' : 'sale',
        acres: num(row.acres),
        mw: num(row.mw),
        price: num(row.price),
        priceUnit: row.price_unit === 'per_mw' ? 'per_mw' : 'per_acre',
        annualRent: num(row.annual_rent),
        escalatorPct: num(row.escalator_pct),
        termYears: num(row.term_years),
        startYear: num(row.start_year),
        bucketId: row.bucket_id,
      }
    case 'fee_margin':
      return {
        ...base,
        type: 'fee_margin',
        referencedLineId: row.referenced_line_id,
        pctOfLine: num(row.pct_of_line),
        isCarveOut: row.is_carve_out,
      }
    default:
      // ⚠ An unknown type is DROPPED rather than guessed at, and the caller
      // counts the drop. A line_type the CHECK allows but this switch does not
      // handle means the schema moved ahead of the code, which must be visible
      // rather than quietly producing a model that is missing revenue.
      return null
  }
}

function moneyShape(value: string | null): MoneyShape | null {
  if (
    value === 'recurring' ||
    value === 'contract' ||
    value === 'one_time' ||
    value === 'asset' ||
    value === 'capture'
  ) {
    return value
  }
  return null
}

/**
 * Load a record's model, or null when it has none.
 *
 * Null is the honest answer for a deal nobody has modelled, and the tab shows
 * the templates rather than an empty model that looks like a $0 deal.
 */
export async function loadEconomics(
  kind: RecordKind,
  recordId: string
): Promise<LoadedEconomics | null> {
  const db = calcDb()
  const { data: header, error } = await db
    .from('deal_economics')
    .select('*')
    .eq(RECORD_SCOPE_COLUMN[kind], recordId)
    .maybeSingle()

  // ⚠ Throw rather than return null on an error. A 42703 from a renamed column
  // comes back on `error` with `data` null, and returning null would read as
  // "this deal has no economics" while reporting nothing anywhere.
  if (error) throw new Error(`Could not load deal economics: ${error.message}`)
  if (!header) return null

  const row = header as DealEconomicsRow
  // ⚠ THE VEHICLES ARE READ BY THE RECORD, NOT BY THE MODEL. They are children
  // of the project or opportunity (20261006000001_project_spvs.sql), so they
  // exist before an economics model does and survive one being rebuilt.
  // `loadProjectSpvs` throws on a database error rather than returning [],
  // because an empty array here would read as "this deal has no vehicles".
  const [sources, buckets, vehicles, lines, provenance] = await Promise.all([
    db.from('economics_capacity_sources').select('*').eq('economics_id', row.id),
    db.from('economics_buckets').select('*').eq('economics_id', row.id),
    loadProjectSpvs(kind, recordId),
    db.from('economics_lines').select('*').eq('economics_id', row.id).order('sort_order'),
    db.from('economics_provenance').select('*').eq('economics_id', row.id),
  ])

  for (const [name, res] of [
    ['capacity sources', sources],
    ['buckets', buckets],
    ['lines', lines],
    ['provenance', provenance],
  ] as const) {
    if (res.error) throw new Error(`Could not load ${name}: ${res.error.message}`)
  }

  const lineRows = (lines.data ?? []) as LineRow[]
  const schedules =
    lineRows.length === 0
      ? { data: [] as ScheduleRow[], error: null }
      : await db
          .from('economics_line_schedule')
          .select('*')
          .in(
            'line_id',
            lineRows.map((l) => l.id)
          )
  if (schedules.error) throw new Error(`Could not load schedules: ${schedules.error.message}`)

  const scheduleByLine = new Map<string, ScheduleRow[]>()
  for (const s of (schedules.data ?? []) as ScheduleRow[]) {
    const list = scheduleByLine.get(s.line_id) ?? []
    list.push(s)
    scheduleByLine.set(s.line_id, list)
  }

  const fieldsByLine = new Map<string, Record<string, Provenance>>()
  const dealFields: Record<string, Provenance> = {}
  for (const p of (provenance.data ?? []) as ProvenanceRow[]) {
    if (p.line_id == null) {
      dealFields[p.field_key] = toProvenance(p)
      continue
    }
    const map = fieldsByLine.get(p.line_id) ?? {}
    map[p.field_key] = toProvenance(p)
    fieldsByLine.set(p.line_id, map)
  }

  const mapped = lineRows.map((l) =>
    toLine(l, toSchedule(scheduleByLine.get(l.id) ?? []), fieldsByLine.get(l.id))
  )
  const dropped = mapped.filter((l) => l == null).length
  if (dropped > 0) {
    // Loud on purpose: the schema allows a line type the code cannot read, so
    // the model on screen is missing revenue and nothing else would say so.
    console.error(
      `[economics] ${dropped} line(s) on ${kind} ${recordId} have a line_type this build cannot read. The model is incomplete.`
    )
  }

  const amount = num(row.stated_total_amount)
  const shape = moneyShape(row.stated_total_shape)

  return {
    economicsId: row.id,
    storedAt: row.computed_at,
    notes: row.notes,
    input: {
      sources: ((sources.data ?? []) as CapacitySourceRow[])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(toSource),
      buckets: ((buckets.data ?? []) as BucketRow[]).map(toBucket),
      // Already ordered by `sort_order` in the query.
      spvs: vehicles.map(toSpv),
      lines: mapped.filter((l): l is RevenueLine => l != null),
      discountRatePct: num(row.discount_rate_pct),
      capRatePct: num(row.cap_rate_pct),
      baseYear: num(row.base_year),
      statedTotal: amount != null && shape != null ? { amount, shape } : null,
    },
  }
}

/** Load a record's model and compute it in one call: what every reader wants. */
export async function loadAndCompute(
  kind: RecordKind,
  recordId: string
): Promise<{ loaded: LoadedEconomics; result: DealEconomicsResult } | null> {
  const loaded = await loadEconomics(kind, recordId)
  if (!loaded) return null
  return { loaded, result: computeDealEconomics(loaded.input) }
}

/**
 * Create an empty model for a record, seeded with the brief's priority buckets.
 *
 * ⚠ BUCKETS ARE SEEDED AND PRICES ARE NOT. The allocation ledger is structure,
 * so starting from blank only means the first line has nowhere to draw from. A
 * price arriving with the structure would be an unsourced planning assumption
 * wearing a template's authority.
 */
export async function createEconomics(
  kind: RecordKind,
  recordId: string,
  actor: { id: string; email?: string | null }
): Promise<string> {
  const db = calcDbAs(actor)
  // Written out rather than built with a computed key: exactly one of the two
  // parent columns is set on every row (the CHECK enforces it), and spelling
  // both out is what makes that readable at the call site.
  const scope: { project_id: string | null; opportunity_id: string | null } =
    kind === 'project'
      ? { project_id: recordId, opportunity_id: null }
      : { project_id: null, opportunity_id: recordId }
  const { data, error } = await db.from('deal_economics').insert(scope).select('id').single()
  if (error) throw new Error(`Could not create deal economics: ${error.message}`)

  const economicsId = (data as { id: string }).id
  const { error: bucketError } = await db.from('economics_buckets').insert(
    DEFAULT_BUCKETS.map((b) => ({
      economics_id: economicsId,
      label: b.label,
      priority: b.priority,
    }))
  )
  if (bucketError) throw new Error(`Could not seed buckets: ${bucketError.message}`)

  return economicsId
}

/**
 * Write the computed figures back onto the model and the pipeline column.
 *
 * ⚠ THE PIPELINE COLUMN IS BER WILSON'S NET CAPTURE AND NOTHING ELSE. That is
 * why `estimated_value` was cleared rather than reused: it meant five different
 * things across eight projects and no total built on it could be defended. Any
 * surface showing this column names which quantity it is.
 *
 * ⚠ AND AN INVALID MODEL WRITES NOTHING TO THE PIPELINE. A model with 160 MW
 * allocated against 150 MW firm has no defensible deal size, so the record
 * keeps whatever it had and the tab shows why. Publishing the number anyway is
 * how a blocked model becomes a figure someone repeats in a meeting.
 */
export async function persistComputed(
  kind: RecordKind,
  recordId: string,
  economicsId: string,
  result: DealEconomicsResult,
  actor: { id: string; email?: string | null }
): Promise<void> {
  const db = calcDbAs(actor)
  const t = result.tiers
  const now = new Date().toISOString()

  const { error } = await db
    .from('deal_economics')
    .update({
      computed_firm_mw: result.ledger.firmMw,
      computed_utilization_pct: result.ledger.utilizationPct,
      computed_gross_annual_recurring: t.grossGenerated.annualRecurringRevenue,
      computed_gross_contract_value: t.grossGenerated.contractValue,
      computed_gross_one_time: t.grossGenerated.oneTimeRevenue,
      computed_gross_project_value: t.grossGenerated.totalProjectValue,
      computed_bw_gross_annual_recurring: t.berWilsonGross.annualRecurringRevenue,
      computed_bw_gross_contract_value: t.berWilsonGross.contractValue,
      computed_bw_gross_one_time: t.berWilsonGross.oneTimeRevenue,
      computed_bw_net_annual_recurring: t.berWilsonNet.annualRecurringRevenue,
      computed_bw_net_contract_value: t.berWilsonNet.contractValue,
      computed_bw_net_one_time: t.berWilsonNet.oneTimeRevenue,
      computed_bw_net_tax_credits: t.berWilsonNet.taxCredits,
      computed_asset_value: t.berWilsonNet.stabilizedAssetValue,
      computed_undetermined_annual_recurring: t.undetermined.annualRecurringRevenue,
      computed_undetermined_one_time: t.undetermined.oneTimeRevenue,
      computed_capture_pct_of_gross: t.capturePctOfGross,
      computed_status: result.status,
      computed_valid: result.valid,
      computed_at: now,
    })
    .eq('id', economicsId)
  if (error) throw new Error(`Could not store computed figures: ${error.message}`)

  if (!result.valid) return

  const capture = captureForPipeline(result)
  const table = kind === 'project' ? 'projects' : 'opportunities'
  const { error: rollupError } = await db
    .from(table)
    .update({
      economics_capture_value: capture,
      economics_status: result.status,
      economics_computed_at: now,
    })
    .eq('id', recordId)
  if (rollupError) throw new Error(`Could not update the pipeline value: ${rollupError.message}`)
}

/**
 * The one number the pipeline rolls up: Ber Wilson's net capture.
 *
 * Contract value plus one-time revenue plus credits, net of SPV ownership. Not
 * annual recurring, which would understate a twenty-year offtake, and not gross
 * generated, which is mostly partners' money.
 *
 * Returns null when nothing has been priced. Null, never 0: a deal with no
 * figures must sort and read as unpriced rather than as worthless.
 */
export function captureForPipeline(result: DealEconomicsResult): number | null {
  const n = result.tiers.berWilsonNet
  const parts = [n.contractValue, n.oneTimeRevenue, n.taxCredits]
  if (parts.every((p) => p == null)) return null
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0)
}

/** Append a version snapshot. Returns the new version number. */
export async function saveVersion(
  economicsId: string,
  input: DealEconomicsInput,
  result: DealEconomicsResult,
  meta: { label?: string | null; note?: string | null },
  actor: { id: string; email?: string | null; name?: string | null }
): Promise<number> {
  const db = calcDbAs(actor)
  const { data: latest, error: readError } = await db
    .from('economics_versions')
    .select('version')
    .eq('economics_id', economicsId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (readError) throw new Error(`Could not read version history: ${readError.message}`)

  const version = ((latest as { version: number } | null)?.version ?? 0) + 1
  const { error } = await db.from('economics_versions').insert({
    economics_id: economicsId,
    version,
    label: meta.label ?? null,
    note: meta.note ?? null,
    input_snapshot: input as unknown,
    result_snapshot: result as unknown,
    created_by: actor.name ?? actor.email ?? null,
  })
  if (error) throw new Error(`Could not save a version: ${error.message}`)
  return version
}

/**
 * A full, uniform column set for an `economics_lines` insert.
 *
 * ⚠ A MULTI-ROW INSERT IS ONE STATEMENT WITH ONE COLUMN LIST, SO A ROW THAT
 * OMITS A COLUMN GETS AN EXPLICIT NULL AND NOT THE DEFAULT (CLAUDE.md §12,
 * 09-15). Four NOT NULL booleans on this table have defaults, so inserting two
 * lines where only one of them mentions `is_ber_wilson_revenue` fails the whole
 * statement — which is the good case. The bad case is a nullable column
 * silently nulled on half the rows. Every writer goes through this helper so
 * the column list cannot vary between rows.
 *
 * Caller-supplied values win; everything else is the column's documented
 * default. Note the defaults here are TRUE for `is_ber_wilson_revenue` and
 * `counts_toward_project_value` and FALSE for the carve-out and power flags,
 * matching the migration, so this helper and the schema cannot drift apart
 * without the round-trip script noticing.
 */
export function lineInsert(
  economicsId: string,
  lineType: string,
  label: string,
  over: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    economics_id: economicsId,
    line_type: lineType,
    label,
    spv_id: null,
    bucket_id: null,
    is_ber_wilson_revenue: true,
    is_carve_out: false,
    counts_toward_project_value: true,
    referenced_line_id: null,
    rides_on_line_id: null,
    start_year: null,
    term_years: null,
    escalator_pct: null,
    ramp: null,
    mw: null,
    it_mw: null,
    acres: null,
    quantity: null,
    units: null,
    price: null,
    price_unit: null,
    price_per_mw: null,
    price_per_unit: null,
    price_per_unit_month: null,
    price_per_mwh: null,
    rate_per_kw_month: null,
    annual_rent: null,
    amount: null,
    capital_base: null,
    cost: null,
    cost_per_mw: null,
    cost_per_unit: null,
    opex_annual: null,
    fixed_om_per_kw_year: null,
    variable_om_per_mwh: null,
    heat_rate: null,
    gas_price_per_mmbtu: null,
    load_factor: null,
    occupancy: null,
    pue: null,
    minimum_take_pct: null,
    annual_rate_pct: null,
    our_share_pct: null,
    pct_of_line: null,
    mode: null,
    fee_base: null,
    disposition: null,
    credit_kind: null,
    attribute_kind: null,
    unit_label: null,
    counterparty: null,
    partner_label: null,
    transferable: false,
    power_passed_through: false,
    power_revenue_retained: false,
    status: 'planning_assumption',
    notes: null,
    sort_order: 0,
    ...over,
  }
}

/**
 * How many revenue lines a record's economics model holds, for the tab bar.
 *
 * ⚠ LINES, NOT MODELS, AND THAT IS WHY. The tab bar renders this number as a
 * badge, so returning 0-or-1 would print "Economics 1" on every modelled deal:
 * a count of something there can only ever be one of, which tells the reader
 * nothing. "Economics 7" says what is in there.
 *
 * It also gets the promotion right. A tab with a count of 0 sits in the More
 * dropdown and is still reachable, so a deal with no model offers one without
 * taking a slot on the main bar, and the tab promotes exactly when there is
 * something to look at. A model that exists but holds no lines yet has nothing
 * to show, and the reader is on the tab anyway while they fill it in.
 *
 * ⚠ Swallows an error as 0 rather than throwing, UNLIKE `loadEconomics`. The
 * difference is what each failure costs: a count that fails hides a tab the
 * reader can still reach from More, while a load that fails silently would
 * show an empty model and read as a deal worth nothing.
 */
export async function hasEconomics(kind: RecordKind, recordId: string): Promise<number> {
  const db = calcDb()
  const { data, error } = await db
    .from('deal_economics')
    .select('id')
    .eq(RECORD_SCOPE_COLUMN[kind], recordId)
    .maybeSingle()
  if (error) {
    console.error('[economics] tab count failed:', error.message)
    return 0
  }
  if (!data) return 0

  const { count, error: lineError } = await db
    .from('economics_lines')
    .select('id', { count: 'exact', head: true })
    .eq('economics_id', (data as { id: string }).id)
  if (lineError) {
    console.error('[economics] line count failed:', lineError.message)
    return 0
  }
  return count ?? 0
}

export interface PendingProposalGroup {
  economicsId: string
  recordKind: RecordKind
  recordId: string
  recordName: string
  path: string
  count: number
}

/**
 * Deals with economics figures proposed and nobody deciding, one row per DEAL.
 *
 * ⚠ GROUPED BY DEAL, NOT BY FIGURE, AND THAT IS THE WHOLE DESIGN. Forty figures
 * read out of one proposal document are one sitting, not forty queue items, and
 * a global queue listing "accept 145 $/kW-month" with no model beside it is
 * precisely where that decision CANNOT be made. /decide aggregates and links;
 * the deciding happens on the tab where the quote sits next to the figure.
 *
 * ⚠ CONFIDENTIAL PROJECTS ARE DROPPED. The queue is a cross-portfolio surface,
 * which is containment territory: `hiddenProjectIds(null)` is used because a
 * count that reaches a brief or a digest can never be stepped up after the fact.
 */
export async function pendingProposalGroups(): Promise<PendingProposalGroup[]> {
  const db = calcDb()
  const { data, error } = await db
    .from('economics_input_proposals')
    .select('economics_id')
    .eq('status', 'pending')
    .limit(5000)
  if (error) throw new Error(`Could not read proposals: ${error.message}`)

  const counts = new Map<string, number>()
  for (const row of (data ?? []) as { economics_id: string }[]) {
    counts.set(row.economics_id, (counts.get(row.economics_id) ?? 0) + 1)
  }
  if (counts.size === 0) return []

  const { data: models, error: modelError } = await db
    .from('deal_economics')
    .select('id,project_id,opportunity_id')
    .in('id', Array.from(counts.keys()))
  if (modelError) throw new Error(`Could not resolve the models: ${modelError.message}`)

  const { hiddenProjectIds } = await import('@/lib/security/confidential')
  const hidden = await hiddenProjectIds(null)

  const rows = (models ?? []) as {
    id: string
    project_id: string | null
    opportunity_id: string | null
  }[]
  const projectIds = rows.map((r) => r.project_id).filter((v): v is string => v != null)
  const opportunityIds = rows.map((r) => r.opportunity_id).filter((v): v is string => v != null)

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient()
  const [projects, opportunities] = await Promise.all([
    projectIds.length > 0
      ? admin.from('projects').select('id,name').in('id', projectIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    opportunityIds.length > 0
      ? admin.from('opportunities').select('id,name').in('id', opportunityIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ])

  const names = new Map<string, string>()
  for (const p of (projects.data ?? []) as { id: string; name: string }[]) names.set(p.id, p.name)
  for (const o of (opportunities.data ?? []) as { id: string; name: string }[]) {
    names.set(o.id, o.name)
  }

  const groups: PendingProposalGroup[] = []
  for (const row of rows) {
    const kind: RecordKind = row.project_id ? 'project' : 'opportunity'
    const recordId = row.project_id ?? row.opportunity_id
    if (!recordId) continue
    if (kind === 'project' && hidden.has(recordId)) continue
    groups.push({
      economicsId: row.id,
      recordKind: kind,
      recordId,
      recordName: names.get(recordId) ?? 'a deal',
      path: `${kind === 'project' ? '/projects' : '/opportunities'}/${recordId}/economics`,
      count: counts.get(row.id) ?? 0,
    })
  }

  return groups.sort((a, b) => b.count - a.count)
}
