/**
 * Turning a request body into a row — the half that is the same for every
 * spec-driven register in the platform.
 *
 * ⚠ THIS WAS EXTRACTED, NOT WRITTEN. Every line below came out of
 * src/lib/governance/registers.ts, which has run the twelve governance
 * registers through it since 2026-09-30. The record-children registry
 * (src/lib/records/children.ts) asks the identical question of a different set
 * of tables, and §12 is explicit about what happens if it answers it in its own
 * file: a fork is hardest to see as two SIBLING MODULES written days apart,
 * because neither looks like a copy. So governance now imports from here and
 * there is one coercion table, not two that agree until one is fixed.
 *
 * ⚠ THE FIELD WHITELIST IS A SECURITY BOUNDARY, NOT A CONVENIENCE. A column
 * absent from `fields` cannot be written by any body, which is what stops a
 * crafted request restamping an author, forging a generated status, or moving a
 * child row onto a different parent record. Nothing reaches PostgREST
 * un-whitelisted.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FieldKind =
  | 'text'
  | 'date'
  | 'bool'
  /** Nullable bool — null means "nobody has decided", which differs from false. */
  | 'tribool'
  | 'int'
  | 'money'
  | 'uuid'
  | 'textarray'
  /**
   * A jsonb column holding a structure the caller owns (a draw schedule).
   *
   * Only an array or an object is accepted. A bare string or number in a jsonb
   * column typechecks at the database and means nothing to any reader, and
   * `JsonIn` (§4) is the write-side type — so the shape is checked here rather
   * than discovered later.
   */
  | 'json'

/** The part of a register spec this module needs. */
export interface FieldSpec {
  fields: Record<string, FieldKind>
  /** Columns that must be present and non-null on a create. */
  required: string[]
  /** Columns constrained to a fixed set, checked before the database sees them. */
  enums?: Record<string, readonly string[]>
}

export type NormalizeResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

function coerce(
  kind: FieldKind,
  raw: unknown,
  column: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null }

  switch (kind) {
    case 'text': {
      if (typeof raw !== 'string') return { ok: false, error: `${column} must be text` }
      const trimmed = raw.trim()
      // '' means "cleared", not "empty string" — a blank text column should read
      // as absent everywhere, and `is null` is the only filter that finds it.
      return { ok: true, value: trimmed.length ? trimmed : null }
    }
    case 'date': {
      if (typeof raw !== 'string') return { ok: false, error: `${column} must be a date` }
      const trimmed = raw.trim()
      if (!trimmed) return { ok: true, value: null }
      if (!DATE_RE.test(trimmed)) return { ok: false, error: `${column} must be a date (YYYY-MM-DD)` }
      return { ok: true, value: trimmed }
    }
    case 'bool':
      return { ok: true, value: raw === true || raw === 'true' || raw === 1 || raw === '1' }
    case 'tribool': {
      if (raw === '' ) return { ok: true, value: null }
      return { ok: true, value: raw === true || raw === 'true' || raw === 1 || raw === '1' }
    }
    case 'int':
    case 'money': {
      if (typeof raw === 'string' && raw.trim() === '') return { ok: true, value: null }
      // Strip the separators a person types into a money field. A reader who
      // writes "1,250,000" means a number, and rejecting it teaches them to
      // distrust the form rather than to type differently.
      const cleaned = typeof raw === 'string' ? raw.replace(/[$,\s]/g, '') : raw
      const n = Number(cleaned)
      if (!Number.isFinite(n)) return { ok: false, error: `${column} must be a number` }
      return { ok: true, value: kind === 'int' ? Math.trunc(n) : n }
    }
    case 'uuid': {
      if (typeof raw !== 'string') return { ok: false, error: `${column} must be an id` }
      const trimmed = raw.trim()
      if (!trimmed) return { ok: true, value: null }
      if (!UUID_RE.test(trimmed)) return { ok: false, error: `${column} is not a valid id` }
      return { ok: true, value: trimmed }
    }
    case 'textarray': {
      if (!Array.isArray(raw)) return { ok: false, error: `${column} must be a list` }
      return {
        ok: true,
        value: raw
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v.length > 0),
      }
    }
    case 'json': {
      if (typeof raw !== 'object') return { ok: false, error: `${column} must be a list or an object` }
      return { ok: true, value: raw }
    }
  }
}

/**
 * Turn a request body into a row for the spec's table, or an error a person can
 * act on.
 *
 * `partial` is the PATCH case: only the keys PRESENT in the body are touched,
 * and nothing is required. That distinction is the point — §12: a field the
 * caller never mentioned must be OMITTED, not nulled, because an explicit NULL
 * does not fall back to the column default. Two of the route files this
 * registry replaces built their update object with `body.x ?? null` for every
 * column, so any partial PATCH would have blanked the rest of the row; both
 * survived only because their one caller happened to send the whole form.
 */
export function normalizePayload(
  spec: FieldSpec,
  body: Record<string, unknown>,
  opts: { partial?: boolean } = {}
): NormalizeResult {
  const value: Record<string, unknown> = {}

  for (const [column, kind] of Object.entries(spec.fields)) {
    if (!(column in body)) continue
    const result = coerce(kind, body[column], column)
    if (!result.ok) return { ok: false, error: result.error }

    const allowed = spec.enums?.[column]
    if (allowed && result.value !== null && !allowed.includes(String(result.value))) {
      return { ok: false, error: `${column} must be one of: ${allowed.join(', ')}` }
    }
    value[column] = result.value
  }

  if (!opts.partial) {
    for (const column of spec.required) {
      if (value[column] === undefined || value[column] === null || value[column] === '') {
        return { ok: false, error: `${column.replace(/_/g, ' ')} is required` }
      }
    }
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: 'Nothing to save' }
  }
  return { ok: true, value }
}
