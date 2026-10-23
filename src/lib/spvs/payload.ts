/**
 * Whitelist and coerce an incoming body against a declared field spec.
 *
 * ⚠ THIS USED TO LIVE IN src/lib/economics/collections.ts AND MOVED HERE WHEN
 * THE CALCULATOR WAS REMOVED (2026-10-23). Nothing about it was ever
 * arithmetic: it is the shape a per-deal child collection's route uses to keep
 * a crafted body out of PostgREST. Vehicles is now its only consumer, so it
 * sits here rather than in a shared module nothing else reads — but the rules
 * below are the ones that must not drift, and src/lib/governance/registers.ts
 * holds the same contract for the admin-only registers.
 *
 * ⚠ THE FIELD WHITELIST IS A SECURITY BOUNDARY, NOT A CONVENIENCE. A request
 * body reaches PostgREST only through the columns a spec names. `id`, the
 * parent pointers and `created_at`/`updated_at` are deliberately absent from
 * every spec, so a crafted body cannot re-parent a row onto a record the caller
 * may write or restamp when it was created.
 *
 * Coercion rules: a money or numeric field strips `$ , whitespace` so a reader
 * can type 1,250,000, and an empty string becomes NULL rather than 0. Absent is
 * not zero anywhere in this feature.
 *
 * Pure, no imports. Safe for a verification script to load.
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

export type NormalizeResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Strip `$`, commas and whitespace so a reader can type `1,250,000`.
 *
 * ⚠ AN EMPTY STRING BECOMES NULL, NOT 0. Clearing a figure must mean "nobody
 * has said" and not "it is zero" — an undecided equity split and a 0% one are
 * different facts about a deal, and so are $0 committed and nobody having said.
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
    // ⚠ A FIELD THE BODY NEVER MENTIONED IS OMITTED, NOT SET TO NULL — ON A
    // CREATE AS WELL AS ON A PATCH. Writing an explicit NULL does not fall back
    // to the column's DEFAULT, it violates its NOT NULL, and two "Add…" buttons
    // had never once worked because of it (CLAUDE.md §12).
    //
    // This is NOT the multi-row rule in §12 (09-15) reversed. That one is about
    // one INSERT carrying several rows, where Postgres demands a uniform column
    // list. A writer building many rows still spells every column out — the
    // standard-vehicle bootstrap does. What is wrong is doing it from a single
    // request body, where "absent" means "the caller did not say".
    if (!(field in body)) continue
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
