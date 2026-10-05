/**
 * Which inputs each revenue line type asks for, declared once.
 *
 * ⚠ THIS IS A SECOND DESCRIPTION OF THE ENGINE AND THEREFORE A DRIFT RISK, so
 * it is kept beside the engine rather than inside a component, and
 * `line-fields.test.ts` asserts that every field named here exists in the
 * collection whitelist and that every type the engine knows has a form. A type
 * with no form is invisible in the UI while working perfectly in the
 * arithmetic, which is exactly the failure mode `documentKind` had with pptx:
 * not unreadable, just never asked about.
 *
 * The labels carry the units, because a rate without its unit is the mistake
 * this whole feature is built to prevent. The hints say what a figure IS, in
 * the words someone would use on a call.
 *
 * Pure data. No imports beyond sibling types.
 */

import type { RevenueLineType } from './types'

export interface LineFieldDef {
  /** The column name, which must appear in COLLECTIONS.lines.fields. */
  name: string
  label: string
  kind: 'number' | 'int' | 'text' | 'bool' | 'select' | 'line_ref' | 'bucket_ref'
  options?: readonly { value: string; label: string }[]
  hint?: string
  placeholder?: string
  /** Shown wider in the grid: a label, a note, a counterparty. */
  wide?: boolean
}

const PRICE_UNIT_ENERGY = [
  { value: 'per_kwh', label: '$/kWh' },
  { value: 'per_mwh', label: '$/MWh' },
] as const

const PRICE_UNIT_CAPACITY = [
  { value: 'per_kw_month', label: '$/kW-month' },
  { value: 'per_kw_year', label: '$/kW-year' },
  { value: 'per_mw_year', label: '$/MW-year' },
] as const

const TERM: LineFieldDef[] = [
  { name: 'start_year', label: 'First year', kind: 'int', hint: 'the year revenue starts' },
  { name: 'term_years', label: 'Term, years', kind: 'int', hint: 'needed for a contract value' },
  {
    name: 'escalator_pct',
    label: 'Annual escalator, %',
    kind: 'number',
    hint: 'compounds from year 2',
  },
]

/** Common to every one-time type. */
const ONE_TIME: LineFieldDef[] = [
  {
    name: 'counts_toward_project_value',
    label: 'Counts toward total project value',
    kind: 'bool',
    hint: 'a build contract does, a land sale and a credit do not',
  },
]

export const LINE_FORM_FIELDS: Record<RevenueLineType, LineFieldDef[]> = {
  energy_sale: [
    {
      name: 'mode',
      label: 'How it is priced',
      kind: 'select',
      options: [
        { value: 'forward', label: 'From a known load' },
        { value: 'reverse', label: 'From a revenue target' },
      ],
      hint: 'reverse reports the average load the target implies',
    },
    { name: 'bucket_id', label: 'Draws from', kind: 'bucket_ref' },
    { name: 'mw', label: 'MW allocated', kind: 'number', hint: 'forward pricing only' },
    {
      name: 'load_factor',
      label: 'Load factor',
      kind: 'number',
      hint: 'a fraction from 0 to 1: how much of the MW is actually consumed on average',
      placeholder: '0.90',
    },
    { name: 'price', label: 'Price', kind: 'number', placeholder: '0.08' },
    { name: 'price_unit', label: 'Price unit', kind: 'select', options: PRICE_UNIT_ENERGY },
    {
      name: 'amount',
      label: 'Target annual revenue',
      kind: 'number',
      hint: 'reverse pricing only',
    },
    {
      name: 'minimum_take_pct',
      label: 'Take-or-pay floor, %',
      kind: 'number',
      hint: 'of contracted volume, if there is one',
    },
    ...TERM,
  ],

  capacity_charge: [
    { name: 'bucket_id', label: 'Draws from', kind: 'bucket_ref' },
    { name: 'mw', label: 'MW reserved', kind: 'number' },
    { name: 'price', label: 'Rate', kind: 'number', placeholder: '11' },
    { name: 'price_unit', label: 'Rate unit', kind: 'select', options: PRICE_UNIT_CAPACITY },
    ...TERM,
  ],

  dc_lease: [
    { name: 'bucket_id', label: 'Draws from', kind: 'bucket_ref' },
    {
      name: 'it_mw',
      label: 'Critical IT MW',
      kind: 'number',
      hint: 'the ledger draws this times PUE as facility load',
    },
    { name: 'rate_per_kw_month', label: 'Rate, $/kW-month', kind: 'number', placeholder: '145' },
    {
      name: 'occupancy',
      label: 'Occupancy at stabilization',
      kind: 'number',
      hint: 'a fraction from 0 to 1',
      placeholder: '0.95',
    },
    { name: 'pue', label: 'PUE', kind: 'number', placeholder: '1.30' },
    {
      name: 'power_passed_through',
      label: 'Power passed through to the tenant',
      kind: 'bool',
    },
    {
      name: 'power_revenue_retained',
      label: 'And kept as revenue anyway',
      kind: 'bool',
      hint: 'unusual: confirm it is deliberate, or the same power is counted twice',
    },
    ...TERM,
  ],

  subscription: [
    { name: 'bucket_id', label: 'Draws from', kind: 'bucket_ref' },
    { name: 'units', label: 'Number of units', kind: 'number' },
    { name: 'unit_label', label: 'What a unit is', kind: 'text', placeholder: 'resident, rack' },
    { name: 'price_per_unit_month', label: 'Price per unit per month', kind: 'number' },
    { name: 'mw', label: 'MW drawn, if any', kind: 'number' },
    ...TERM,
  ],

  om_service: [
    {
      name: 'mw',
      label: 'MW the fee is priced on',
      kind: 'number',
      hint: 'a pricing basis, not an allocation: maintaining a plant consumes none of it',
    },
    { name: 'price', label: 'Rate', kind: 'number', placeholder: '18' },
    { name: 'price_unit', label: 'Rate unit', kind: 'select', options: PRICE_UNIT_CAPACITY },
    { name: 'counterparty', label: 'Who pays', kind: 'text', wide: true },
    ...TERM,
  ],

  energy_attribute: [
    {
      name: 'rides_on_line_id',
      label: 'Rides on',
      kind: 'line_ref',
      hint: 'the energy line whose volume this is paid on. Draws no megawatts of its own',
    },
    { name: 'price_per_mwh', label: 'Price, $/MWh', kind: 'number', placeholder: '11' },
    { name: 'attribute_kind', label: 'Kind', kind: 'text', placeholder: 'REC, offset' },
    ...TERM,
  ],

  recurring_fee_on_line: [
    {
      name: 'fee_base',
      label: 'Charged against',
      kind: 'select',
      options: [
        { value: 'referenced_line_value', label: "Another line's total value" },
        { value: 'referenced_line_annual_revenue', label: "Another line's annual revenue" },
        { value: 'capital_base', label: 'A capital figure entered here' },
      ],
      hint: '1.5% of a capital base and 1.5% of annual revenue differ by two orders of magnitude',
      wide: true,
    },
    { name: 'referenced_line_id', label: 'The line', kind: 'line_ref' },
    { name: 'capital_base', label: 'Capital base', kind: 'number' },
    { name: 'annual_rate_pct', label: 'Rate, % a year', kind: 'number', placeholder: '1.5' },
    {
      name: 'our_share_pct',
      label: 'Our share of the fee, %',
      kind: 'number',
      hint: '50 for an even split with a partner',
      placeholder: '50',
    },
    { name: 'partner_label', label: 'Partner', kind: 'text', wide: true },
    {
      name: 'is_carve_out',
      label: 'Carved out of the referenced line',
      kind: 'bool',
      hint: 'off for a commission the owner pays on top, on for a margin inside the contract',
    },
    ...TERM,
  ],

  one_time_per_mw: [
    { name: 'mw', label: 'MW', kind: 'number' },
    { name: 'price_per_mw', label: 'Price per MW', kind: 'number', placeholder: '17,500,000' },
    { name: 'cost_per_mw', label: 'Cost per MW', kind: 'number' },
    ...ONE_TIME,
  ],

  one_time_per_unit: [
    { name: 'quantity', label: 'Quantity', kind: 'number' },
    {
      name: 'unit_label',
      label: 'What a unit is',
      kind: 'text',
      hint: 'homes, lots, tons, square feet, pads',
      placeholder: 'square feet',
    },
    { name: 'price_per_unit', label: 'Price per unit', kind: 'number', placeholder: '33' },
    { name: 'cost_per_unit', label: 'Cost per unit', kind: 'number' },
    ...ONE_TIME,
  ],

  one_time_lump: [
    { name: 'amount', label: 'Amount', kind: 'number' },
    { name: 'cost', label: 'Cost', kind: 'number' },
    ...ONE_TIME,
  ],

  tax_credit: [
    {
      name: 'credit_kind',
      label: 'Credit',
      kind: 'select',
      options: [
        { value: '48E', label: '48E investment' },
        { value: '45X', label: '45X advanced manufacturing' },
        { value: '45Q', label: '45Q carbon' },
        { value: 'other', label: 'Other' },
      ],
    },
    { name: 'amount', label: 'Credit amount', kind: 'number' },
    { name: 'our_share_pct', label: 'Our share after transfer, %', kind: 'number' },
    { name: 'transferable', label: 'Transferable', kind: 'bool' },
    ...ONE_TIME,
  ],

  land: [
    {
      name: 'disposition',
      label: 'Sale or lease',
      kind: 'select',
      options: [
        { value: 'sale', label: 'Sale' },
        { value: 'lease', label: 'Lease' },
      ],
    },
    { name: 'acres', label: 'Acres', kind: 'number' },
    {
      name: 'mw',
      label: 'MW of powered land',
      kind: 'number',
      hint: 'powered land priced per MW allocates those megawatts',
    },
    { name: 'price', label: 'Price', kind: 'number' },
    {
      name: 'price_unit',
      label: 'Price unit',
      kind: 'select',
      options: [
        { value: 'per_acre', label: '$/acre' },
        { value: 'per_mw', label: '$/MW' },
      ],
    },
    { name: 'bucket_id', label: 'Draws from', kind: 'bucket_ref' },
    { name: 'annual_rent', label: 'Annual rent', kind: 'number', hint: 'lease only' },
    { name: 'escalator_pct', label: 'Annual escalator, %', kind: 'number' },
    { name: 'term_years', label: 'Term, years', kind: 'int' },
    { name: 'start_year', label: 'First year', kind: 'int' },
    ...ONE_TIME,
  ],

  fee_margin: [
    { name: 'referenced_line_id', label: 'Taken on', kind: 'line_ref' },
    { name: 'pct_of_line', label: 'Percentage', kind: 'number', placeholder: '12' },
    {
      name: 'is_carve_out',
      label: 'Carved out of that line',
      kind: 'bool',
      hint: 'on for a margin inside the contract, which keeps the gross from double counting',
    },
  ],
}

/** Shown on every line whatever its type. */
export const LINE_COMMON_FIELDS: LineFieldDef[] = [
  { name: 'label', label: 'Name', kind: 'text', wide: true },
  {
    name: 'is_ber_wilson_revenue',
    label: "This is Ber Wilson's revenue",
    kind: 'bool',
    hint: 'off for a partner-built package: revenue at the project, none of it ours',
  },
  {
    name: 'status',
    label: 'How well sourced',
    kind: 'select',
    options: [
      { value: 'planning_assumption', label: 'Planning assumption' },
      { value: 'benchmark', label: 'Benchmark' },
      { value: 'vendor_quoted', label: 'Vendor quoted' },
      { value: 'loi_term_sheet', label: 'LOI or term sheet' },
      { value: 'contracted', label: 'Contracted' },
      { value: 'validated', label: 'Validated' },
    ],
  },
  { name: 'notes', label: 'Notes', kind: 'text', wide: true },
]
