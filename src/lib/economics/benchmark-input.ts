/**
 * Validating a benchmark row on the way in.
 *
 * Separate from the route so the create and update paths cannot disagree, the
 * same shape `src/lib/leads/category-input.ts` uses.
 *
 * ⚠ A BENCHMARK WITH NO SOURCE AND NO DATE IS A RUMOUR, and this is where that
 * is enforced rather than hoped for. Picking one sets an input's provenance to
 * "Benchmark" with this row's source, so an unsourced benchmark would launder a
 * guess into something that looks researched. It is allowed to be saved
 * (someone may be mid-entry) but it is flagged `needs_review` automatically.
 */

import { BENCHMARK_TONES } from './benchmarks'

export type BenchmarkPatchResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

function text(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

function numeric(raw: unknown): number | null | 'invalid' {
  if (raw == null || raw === '') return null
  const cleaned = String(raw).replace(/[$,\s%]/g, '')
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : 'invalid'
}

export function normalizeBenchmarkPatch(
  body: Record<string, unknown>,
  opts: { requireKey?: boolean } = {}
): BenchmarkPatchResult {
  const value: Record<string, unknown> = {}

  if ('key' in body || opts.requireKey) {
    const key = text(body.key)
    if (opts.requireKey && !key) return { ok: false, error: 'A key is required' }
    if (key) {
      // The key is the handle a line's provenance points at, so it has to be
      // stable and typeable. A rename cascades; a key with spaces does not.
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) {
        return {
          ok: false,
          error: 'A key is lowercase letters, numbers, hyphens and underscores, for example dc-lease-primary',
        }
      }
      value.key = key
    }
  }

  if ('label' in body || opts.requireKey) {
    const label = text(body.label)
    if (opts.requireKey && !label) return { ok: false, error: 'A name is required' }
    if (label) value.label = label
  }

  if ('unit' in body || opts.requireKey) {
    const unit = text(body.unit)
    if (opts.requireKey && !unit) {
      // ⚠ The unit is the whole point. A benchmark of "145" is meaningless and
      // filling an input from it would be the exact unit error this engine is
      // built to prevent.
      return { ok: false, error: 'A unit is required: $/kW-month, $/MW, $/kWh, %, Btu/kWh' }
    }
    if (unit) value.unit = unit
  }

  for (const field of ['value_low', 'value_high'] as const) {
    if (!(field in body)) continue
    const parsed = numeric(body[field])
    if (parsed === 'invalid') return { ok: false, error: `"${field}" is not a number` }
    value[field] = parsed
  }

  if (
    value.value_low != null &&
    value.value_high != null &&
    (value.value_low as number) > (value.value_high as number)
  ) {
    return { ok: false, error: 'The low end of the range is above the high end' }
  }

  for (const field of ['geography', 'source', 'notes'] as const) {
    if (field in body) value[field] = text(body[field])
  }

  if ('as_of' in body) {
    const raw = body.as_of
    if (raw == null || raw === '') value.as_of = null
    else if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return { ok: false, error: 'A date must be YYYY-MM-DD' }
    } else value.as_of = raw
  }

  if ('tone' in body) {
    const tone = text(body.tone) ?? 'slate'
    // ⚠ A tone NAME against a palette declared in source, never a class string.
    // Tailwind v4 emits only what it finds by scanning source, so a class from
    // the database produces an unstyled element with no error anywhere. An
    // unknown tone is REJECTED rather than defaulted, so a typo is visible.
    if (!(BENCHMARK_TONES as readonly string[]).includes(tone)) {
      return { ok: false, error: `A tone must be one of: ${BENCHMARK_TONES.join(', ')}` }
    }
    value.tone = tone
  }

  for (const field of ['active', 'needs_review'] as const) {
    if (!(field in body)) continue
    const raw = body[field]
    if (typeof raw === 'boolean') value[field] = raw
    else if (raw === 'true') value[field] = true
    else if (raw === 'false') value[field] = false
    else return { ok: false, error: `"${field}" must be true or false` }
  }

  if ('sort_order' in body) {
    const parsed = numeric(body.sort_order)
    if (parsed === 'invalid') return { ok: false, error: 'Sort order is not a number' }
    value.sort_order = parsed == null ? 100 : Math.trunc(parsed)
  }

  // An unsourced or undated benchmark is saved but marked for review, unless
  // the caller is explicitly setting that flag itself.
  if (!('needs_review' in body)) {
    const source = 'source' in value ? value.source : undefined
    const asOf = 'as_of' in value ? value.as_of : undefined
    if (source === null || asOf === null) value.needs_review = true
  }

  if (Object.keys(value).length === 0) return { ok: false, error: 'Nothing to update' }
  return { ok: true, value }
}
