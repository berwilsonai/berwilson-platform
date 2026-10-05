/**
 * The four child collections of a deal economics model, declared once.
 *
 * ⚠ THE FIELD WHITELIST IS A SECURITY BOUNDARY, NOT A CONVENIENCE. A request
 * body reaches PostgREST only through the columns named below. `id`,
 * `economics_id`, `created_at` and `updated_at` are deliberately absent, so a
 * crafted body cannot move a line onto another deal's model or restamp when it
 * was created. This is the same contract src/lib/governance/registers.ts holds
 * and the same reason it holds it.
 *
 * ⚠ IT IS A SEPARATE MODULE FROM THE REGISTERS FOR ONE REASON: those routes are
 * admin-only and unconditional, with no record scoping and no `canAccessRecord`
 * anywhere in the path. That is right for a global register and wrong for a
 * per-deal model, which must honour a confidential project.
 *
 * Coercion rules match the registers' `normalizeRegisterPayload`: a money or
 * numeric field strips `$ , whitespace` so a reader can type 1,250,000, and an
 * empty string becomes NULL rather than 0. Absent is not zero anywhere in this
 * feature.
 */

export type FieldKind = 'text' | 'number' | 'bool' | 'int' | 'date' | 'uuid' | 'numarray'

export interface CollectionSpec {
  table: string
  label: string
  fields: Record<string, FieldKind>
  /** Values a text field is allowed to hold, mirroring the column's CHECK. */
  enums?: Record<string, readonly string[]>
  required: string[]
  orderBy: { column: string; ascending: boolean }
}

const PROVENANCE_STATUSES = [
  'planning_assumption',
  'benchmark',
  'vendor_quoted',
  'loi_term_sheet',
  'contracted',
  'validated',
] as const

export const COLLECTIONS: Record<string, CollectionSpec> = {
  sources: {
    table: 'economics_capacity_sources',
    label: 'Capacity source',
    fields: {
      label: 'text',
      kind: 'text',
      nameplate_mw: 'number',
      availability_pct: 'number',
      block_count: 'int',
      redundant_blocks: 'int',
      block_mw: 'number',
      stated_net_mw: 'number',
      status: 'text',
      sort_order: 'int',
    },
    enums: {
      kind: ['grid_interconnect', 'onsite_generation', 'storage'],
      status: PROVENANCE_STATUSES,
    },
    required: ['label'],
    orderBy: { column: 'sort_order', ascending: true },
  },

  buckets: {
    table: 'economics_buckets',
    label: 'Allocation bucket',
    fields: { label: 'text', priority: 'int', peak_mw: 'number' },
    required: ['label'],
    orderBy: { column: 'priority', ascending: true },
  },

  spvs: {
    table: 'economics_spvs',
    label: 'SPV',
    fields: {
      label: 'text',
      purpose: 'text',
      entity_id: 'uuid',
      // Left nullable on purpose. An unset split means "not yet determined"
      // and is reported as undetermined, never as 100%.
      bw_ownership_pct: 'number',
      status: 'text',
      sort_order: 'int',
    },
    enums: {
      purpose: ['land', 'energy', 'data_center', 'housing', 'other'],
      status: PROVENANCE_STATUSES,
    },
    required: ['label'],
    orderBy: { column: 'sort_order', ascending: true },
  },

  lines: {
    table: 'economics_lines',
    label: 'Revenue line',
    fields: {
      line_type: 'text',
      label: 'text',
      spv_id: 'uuid',
      bucket_id: 'uuid',
      is_ber_wilson_revenue: 'bool',
      is_carve_out: 'bool',
      counts_toward_project_value: 'bool',
      referenced_line_id: 'uuid',
      rides_on_line_id: 'uuid',
      start_year: 'int',
      term_years: 'int',
      escalator_pct: 'number',
      ramp: 'numarray',
      mw: 'number',
      it_mw: 'number',
      acres: 'number',
      quantity: 'number',
      units: 'number',
      price: 'number',
      price_unit: 'text',
      price_per_mw: 'number',
      price_per_unit: 'number',
      price_per_unit_month: 'number',
      price_per_mwh: 'number',
      rate_per_kw_month: 'number',
      annual_rent: 'number',
      amount: 'number',
      capital_base: 'number',
      cost: 'number',
      cost_per_mw: 'number',
      cost_per_unit: 'number',
      opex_annual: 'number',
      fixed_om_per_kw_year: 'number',
      variable_om_per_mwh: 'number',
      heat_rate: 'number',
      gas_price_per_mmbtu: 'number',
      load_factor: 'number',
      occupancy: 'number',
      pue: 'number',
      minimum_take_pct: 'number',
      annual_rate_pct: 'number',
      our_share_pct: 'number',
      pct_of_line: 'number',
      mode: 'text',
      fee_base: 'text',
      disposition: 'text',
      credit_kind: 'text',
      attribute_kind: 'text',
      unit_label: 'text',
      counterparty: 'text',
      partner_label: 'text',
      transferable: 'bool',
      power_passed_through: 'bool',
      power_revenue_retained: 'bool',
      status: 'text',
      notes: 'text',
      sort_order: 'int',
    },
    enums: {
      // Mirrors the column's CHECK. A value outside this list is refused at the
      // edge with a sentence, rather than reaching Postgres and coming back as
      // a constraint-violation string nobody can act on.
      line_type: [
        'energy_sale',
        'capacity_charge',
        'dc_lease',
        'subscription',
        'om_service',
        'energy_attribute',
        'recurring_fee_on_line',
        'one_time_per_mw',
        'one_time_per_unit',
        'one_time_lump',
        'tax_credit',
        'land',
        'fee_margin',
      ],
      price_unit: [
        'per_kwh',
        'per_mwh',
        'per_kw_month',
        'per_kw_year',
        'per_mw_year',
        'per_acre',
        'per_mw',
      ],
      mode: ['forward', 'reverse'],
      fee_base: ['referenced_line_value', 'referenced_line_annual_revenue', 'capital_base'],
      disposition: ['sale', 'lease'],
      credit_kind: ['48E', '45X', '45Q', 'other'],
      status: PROVENANCE_STATUSES,
    },
    required: ['line_type', 'label'],
    orderBy: { column: 'sort_order', ascending: true },
  },

  provenance: {
    table: 'economics_provenance',
    label: 'Source',
    fields: {
      line_id: 'uuid',
      field_key: 'text',
      status: 'text',
      source: 'text',
      source_ref: 'text',
      as_of: 'date',
      note: 'text',
    },
    enums: { status: PROVENANCE_STATUSES },
    required: ['field_key'],
    orderBy: { column: 'field_key', ascending: true },
  },
}

export type CollectionName = keyof typeof COLLECTIONS

/** Prototype-pollution-safe lookup, as `getRegister` does. */
export function getCollection(name: string): CollectionSpec | null {
  if (!Object.prototype.hasOwnProperty.call(COLLECTIONS, name)) return null
  return COLLECTIONS[name]
}

export type NormalizeResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Strip `$`, commas and whitespace so a reader can type `1,250,000`.
 *
 * ⚠ AN EMPTY STRING BECOMES NULL, NOT 0. Clearing a price must mean "nobody has
 * said" and not "it is free", because 0 is a figure the engine will happily
 * compute a deal size from.
 */
function coerceNumber(raw: unknown): number | null | 'invalid' {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 'invalid'
  if (typeof raw !== 'string') return 'invalid'
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (cleaned === '') return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 'invalid'
}

function coerce(kind: FieldKind, raw: unknown): unknown | 'invalid' {
  switch (kind) {
    case 'text': {
      if (raw == null) return null
      if (typeof raw !== 'string') return 'invalid'
      const trimmed = raw.trim()
      return trimmed === '' ? null : trimmed
    }
    case 'bool':
      if (raw == null) return null
      if (typeof raw === 'boolean') return raw
      if (raw === 'true') return true
      if (raw === 'false') return false
      return 'invalid'
    case 'number':
      return coerceNumber(raw)
    case 'int': {
      const value = coerceNumber(raw)
      if (value === 'invalid' || value == null) return value
      return Math.trunc(value)
    }
    case 'date': {
      if (raw == null || raw === '') return null
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'invalid'
      return raw
    }
    case 'uuid': {
      if (raw == null || raw === '') return null
      if (
        typeof raw !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
      ) {
        return 'invalid'
      }
      return raw
    }
    case 'numarray': {
      if (raw == null || raw === '') return null
      if (!Array.isArray(raw)) return 'invalid'
      const out: number[] = []
      for (const item of raw) {
        const value = coerceNumber(item)
        if (value === 'invalid' || value == null) return 'invalid'
        out.push(value)
      }
      return out.length > 0 ? out : null
    }
  }
}

/**
 * Whitelist, coerce and validate an incoming body.
 *
 * `partial` is the PATCH case: only the keys actually present are touched and
 * nothing is required, so clearing one field cannot blank the rest of a row.
 */
export function normalizeCollectionPayload(
  spec: CollectionSpec,
  body: Record<string, unknown>,
  opts: { partial?: boolean } = {}
): NormalizeResult {
  const value: Record<string, unknown> = {}

  for (const [field, kind] of Object.entries(spec.fields)) {
    if (opts.partial && !(field in body)) continue
    const coerced = coerce(kind, body[field])
    if (coerced === 'invalid') {
      return { ok: false, error: `"${field}" is not a valid ${kind}` }
    }
    const allowed = spec.enums?.[field]
    if (allowed && coerced != null && !allowed.includes(String(coerced))) {
      return {
        ok: false,
        error: `"${field}" must be one of: ${allowed.join(', ')}`,
      }
    }
    value[field] = coerced
  }

  if (!opts.partial) {
    for (const field of spec.required) {
      if (value[field] == null) {
        return { ok: false, error: `"${field}" is required` }
      }
    }
  }

  return { ok: true, value }
}

/**
 * Turn a Postgres error into a sentence that names the fix.
 *
 * The constraint names are the ones this feature's migration declares, so a
 * reader gets "this deal already has a model" rather than a 23505 and a string
 * of identifiers.
 */
export function explainEconomicsError(message: string, code?: string): string {
  if (code === '23505' && message.includes('deal_economics_project_id')) {
    return 'This record already has an economics model.'
  }
  if (code === '23505' && message.includes('economics_buckets_economics_id_label')) {
    return 'An allocation bucket with that name already exists on this model.'
  }
  if (code === '23505' && message.includes('economics_spvs_economics_id_label')) {
    return 'An SPV with that name already exists on this model.'
  }
  if (code === '23514' && message.includes('stated_total_check')) {
    return 'A stated deal total needs both an amount and which figure it is (annual, contract, one-time, asset or capture).'
  }
  if (code === '23514' && message.includes('line_type_check')) {
    return 'That is not a revenue line type this build knows how to calculate.'
  }
  if (code === '23503') {
    return 'That references a row that does not exist, or no longer does.'
  }
  return message
}
