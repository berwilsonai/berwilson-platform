/**
 * THE fields a project can be edited in place, and how each one is edited.
 *
 * Richard, 2026-10-30: *"Make all those fields editable on a project by double
 * clicking rather than going to the 'edit' button."*
 *
 * ⚠ ONE SPEC, READ BY BOTH SIDES. The renderer (`InlineField`) needs to know
 * which control a field takes and what its options are; the PATCH route needs
 * to know which columns a browser may write and what values are legal. Those
 * are the same question asked twice, and §12 is explicit about what happens
 * when it is answered twice: of 61 one-table route handlers with one write
 * verb, 22 had no record check at all, and the fix is that the check belongs
 * in the one spec the routes share. So the whitelist IS this table — the route
 * iterates it and cannot be handed a column that is not here.
 *
 * ⚠ AND THE OPTION LISTS COME FROM THE REGISTRY, NEVER TYPED HERE. A stage
 * list written into this file would be a seventh copy of the vocabulary, which
 * is exactly what made the 10-30 rename a ten-file change (§12 — a
 * hand-written enumeration beside a registry drifts).
 *
 * Deliberately ABSENT, and each absence is the decision:
 *   - `confidential` — containment, never a double-click. §12 holds that
 *     containment and access must not share a path, and a field you can change
 *     by mis-clicking is not a containment control.
 *   - `name` — renaming a deal re-keys every alias, every Drive folder path
 *     and every learned meeting title pointing at it. That belongs on the full
 *     edit form, where the consequences can be stated.
 *   - `parent_project_id` — re-parenting changes what a program's value sums
 *     over. A picker, not an inline edit.
 *   - `match_aliases` — an asserted alias is a fact that reaches every matcher
 *     (§12); it has its own editor for that reason.
 */

import {
  STAGES, STAGE_LABELS,
  STATUSES, STATUS_LABELS,
  SECTORS, SECTOR_LABELS,
  BID_DECISIONS, BID_DECISION_LABELS,
  WIN_BANDS, WIN_BAND_LABELS, WIN_BAND_VALUE,
  winBand,
} from '@/lib/utils/constants'

/** How a value is captured. */
export type InlineKind = 'text' | 'textarea' | 'select' | 'date' | 'money' | 'band'

export interface InlineFieldSpec {
  /** What the reader sees above the value. */
  label: string
  kind: InlineKind
  /** For `select` and `band`: the options, in order. */
  options?: ReadonlyArray<{ value: string; label: string }>
  /**
   * May this field be emptied?
   *
   * ⚠ NOT COSMETIC — `sector` IS NOT NULL WITH NO DEFAULT. §12: a field the
   * caller never mentioned must be OMITTED rather than nulled, but omission
   * only works where a default exists, and for `sector` an explicit null is
   * `23502`, which fails the whole update rather than the field. `stage` is
   * NOT NULL with a default, so it cannot be cleared either. The rest are
   * nullable and clearing one is a real thing to want.
   */
  clearable: boolean
  /** A one-line hint shown while editing, where the field needs one. */
  hint?: string
}

const asOptions = <T extends string>(
  values: readonly T[],
  labels: Record<T, string>
): ReadonlyArray<{ value: string; label: string }> =>
  values.map((v) => ({ value: v, label: labels[v] }))

export const PROJECT_INLINE_FIELDS = {
  // ─── where the deal stands ───────────────────────────────────────────────
  stage: {
    label: 'Stage',
    kind: 'select',
    options: asOptions(STAGES, STAGE_LABELS),
    clearable: false,
  },
  status: {
    label: 'Status',
    kind: 'select',
    options: asOptions(STATUSES, STATUS_LABELS),
    clearable: true,
    hint: 'Being worked, or parked. The outcome is the stage.',
  },
  sector: {
    label: 'Sector',
    kind: 'select',
    options: asOptions(SECTORS, SECTOR_LABELS),
    clearable: false,
  },
  /**
   * ⚠ THE ONE FIELD WHOSE STORED SHAPE IS NOT WHAT IS PICKED. The column is
   * `int4` so `weightedValue()` keeps working; the picker offers three bands
   * and the route stores `WIN_BAND_VALUE[band]`. See the win-band block in
   * `constants.ts` for why that beats a text column.
   */
  win_probability: {
    label: 'Win probability',
    kind: 'band',
    options: asOptions(WIN_BANDS, WIN_BAND_LABELS),
    clearable: true,
    hint: 'Your own read on whether we win it.',
  },
  bid_decision: {
    label: 'Decision',
    kind: 'select',
    options: asOptions(BID_DECISIONS, BID_DECISION_LABELS),
    clearable: false,
  },

  // ─── the money ───────────────────────────────────────────────────────────
  estimated_value: {
    label: 'Estimated value',
    kind: 'money',
    clearable: true,
    hint: 'Whole dollars.',
  },

  // ─── the contract ────────────────────────────────────────────────────────
  contract_type: {
    label: 'Contract type',
    kind: 'select',
    options: [
      { value: 'FFP', label: 'FFP' },
      { value: 'CPFF', label: 'CPFF' },
      { value: 'T&M', label: 'T&M' },
      { value: 'GMP', label: 'GMP' },
      { value: 'Lump Sum', label: 'Lump Sum' },
      { value: 'Cost Plus', label: 'Cost Plus' },
    ],
    clearable: true,
  },
  delivery_method: {
    label: 'Delivery method',
    kind: 'select',
    options: [
      { value: 'Design-Build', label: 'Design-Build' },
      { value: 'Design-Bid-Build', label: 'Design-Bid-Build' },
      { value: 'CMAR', label: 'CMAR' },
      { value: 'CM/GC', label: 'CM/GC' },
      { value: 'Progressive Design-Build', label: 'Progressive Design-Build' },
    ],
    clearable: true,
  },
  client_entity: { label: 'Client entity', kind: 'text', clearable: true },
  location: {
    label: 'Location',
    kind: 'text',
    clearable: true,
    // Richard's own open item: two records read literally "Texas", so a state
    // centroid pins them ~300 miles off — exact-looking and wrong.
    hint: 'A town, not a state — the map pins whatever is here.',
  },
  solicitation_number: { label: 'Solicitation no.', kind: 'text', clearable: true },

  // ─── the pursuit ─────────────────────────────────────────────────────────
  capture_lead: { label: 'Capture lead', kind: 'text', clearable: true },
  incumbent: { label: 'Incumbent', kind: 'text', clearable: true },
  description: { label: 'Description', kind: 'textarea', clearable: true },
  win_strategy: { label: 'Win strategy', kind: 'textarea', clearable: true },

  // ─── the dates ───────────────────────────────────────────────────────────
  bid_due_date: { label: 'Bid due', kind: 'date', clearable: true },
  award_date: { label: 'Award', kind: 'date', clearable: true },
  ntp_date: { label: 'NTP', kind: 'date', clearable: true },
  substantial_completion_date: {
    label: 'Substantial completion',
    kind: 'date',
    clearable: true,
  },
} as const satisfies Record<string, InlineFieldSpec>

export type InlineFieldName = keyof typeof PROJECT_INLINE_FIELDS

/**
 * The same table, seen as the interface rather than as literals.
 *
 * ⚠ BOTH VIEWS ARE NEEDED AND NEITHER IS REDUNDANT. `as const satisfies` is
 * what gives `InlineFieldName` its literal keys — which is what makes the
 * PATCH whitelist and `TablesUpdate<'projects'>` check each other at compile
 * time. But it also narrows each VALUE to its own shape, so `spec.options` is
 * a type error on the union: the money entry genuinely has no `options`
 * property to read. Reading through this view asks the interface instead,
 * where `options` is optional and therefore always addressable.
 */
export const INLINE_SPECS: Record<InlineFieldName, InlineFieldSpec> = PROJECT_INLINE_FIELDS

export const INLINE_FIELD_NAMES = Object.keys(PROJECT_INLINE_FIELDS) as InlineFieldName[]

/**
 * Is this a column a browser may edit in place? Narrows a key off the wire.
 *
 * ⚠ `hasOwnProperty`, NOT `in` — AND THE DIFFERENCE IS A SECURITY BOUNDARY,
 * not a style preference. `in` walks the prototype chain, so `'toString'`,
 * `'constructor'`, `'valueOf'` and `'__proto__'` all answered TRUE. This
 * function is the whole whitelist for `PATCH /api/projects/[id]`, so with `in`
 * a request body of `{"toString": "x"}` passed the gate, reached
 * `coerceInlineValue` (which found a spec on Object.prototype and crashed or
 * coerced nonsense), and at best sent Postgres a column named `toString` —
 * `42703`, which fails the WHOLE update and discards every legitimate field
 * sent alongside it (§12).
 *
 * Caught by `inline-fields.test.ts`, which walks the junk values rather than
 * only the good ones. Nothing in the UI could send these; the route is
 * reachable by anything that can authenticate.
 */
export function isInlineField(name: unknown): name is InlineFieldName {
  return (
    typeof name === 'string' &&
    Object.prototype.hasOwnProperty.call(PROJECT_INLINE_FIELDS, name)
  )
}

export function inlineFieldSpec(name: InlineFieldName): InlineFieldSpec {
  return INLINE_SPECS[name]
}

/**
 * What goes in the column, for a value that came out of a control.
 *
 * ⚠ THE ONE PLACE A BAND BECOMES A NUMBER, which is why this is a function
 * rather than done at the call site. Two surfaces write win probability (the
 * record rail and the pipeline board's quick edit) and a third will; if either
 * mapped the band itself they could disagree, and a human picking "High" would
 * see "Medium" come back with nothing erroring.
 *
 * Returns `{ ok: false, error }` rather than throwing — every caller is a
 * route that has to answer with a sentence a person can read.
 */
export function coerceInlineValue(
  name: InlineFieldName,
  raw: unknown
): { ok: true; value: string | number | null } | { ok: false; error: string } {
  const spec = INLINE_SPECS[name]

  // One definition of empty, applied before anything else looks at the value.
  const isEmpty =
    raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')

  if (isEmpty) {
    if (!spec.clearable) {
      // §12: where a NOT NULL column has no honest value, REFUSE and say why
      // rather than guessing a member of its enum.
      return { ok: false, error: `${spec.label} cannot be emptied — pick a value.` }
    }
    return { ok: true, value: null }
  }

  switch (spec.kind) {
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string') return { ok: false, error: `${spec.label} must be text.` }
      return { ok: true, value: raw.trim() }
    }

    case 'select': {
      const allowed = spec.options?.map((o) => o.value) ?? []
      if (typeof raw !== 'string' || !allowed.includes(raw)) {
        // Names the options, because a value outside an enum fails the WHOLE
        // update and the caller otherwise gets a bare 500 (§12).
        return {
          ok: false,
          error: `${spec.label} must be one of: ${spec.options?.map((o) => o.label).join(', ')}.`,
        }
      }
      return { ok: true, value: raw }
    }

    case 'band': {
      // The band is what a human picked; the column holds its percentage.
      const band = WIN_BANDS.find((b) => b === raw)
      if (!band) {
        return {
          ok: false,
          error: `${spec.label} must be ${WIN_BANDS.map((b) => WIN_BAND_LABELS[b]).join(', ')}.`,
        }
      }
      return { ok: true, value: WIN_BAND_VALUE[band] }
    }

    case 'money': {
      // Accepts what a person actually types into a money field — "$12,500",
      // "12500", " 12500 " — and refuses the rest by name.
      const cleaned = String(raw).replace(/[$,\s]/g, '')
      const n = Number(cleaned)
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: `${spec.label} must be a positive number.` }
      }
      return { ok: true, value: Math.round(n) }
    }

    case 'date': {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return { ok: false, error: `${spec.label} must be a date (YYYY-MM-DD).` }
      }
      return { ok: true, value: raw }
    }
  }
}

/**
 * What the control shows when the editor opens, for a value off the row.
 *
 * The inverse of `coerceInlineValue` — and the reason the band round trip is
 * tested: `win_probability` goes out as a number and must come back as the
 * band a human would recognise, or the picker opens on the wrong option.
 */
export function inlineEditValue(name: InlineFieldName, stored: unknown): string {
  const spec = INLINE_SPECS[name]
  if (stored === null || stored === undefined) return ''
  if (spec.kind === 'band') return winBand(Number(stored)) ?? ''
  return String(stored)
}
