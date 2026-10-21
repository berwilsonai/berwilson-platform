/**
 * Validation for a contact-role registry write.
 *
 * Mirrors src/lib/leads/category-input.ts: one normalizer shared by POST and
 * PATCH, so the two cannot disagree about what a valid role is.
 *
 * ⚠ THE FIELD LIST IS A SECURITY BOUNDARY, NOT A CONVENIENCE (§4, on the
 * governance registers). A body that could set `system` would let a caller
 * un-protect a reserved row and then delete it; a body that could set `key`
 * on a PATCH would re-point every party_roles row that cascades off it.
 * Neither is reachable from here.
 */

export interface RolePatch {
  key?: string
  label?: string
  role_group?: string
  extraction_hint?: string | null
  sort_order?: number
  active?: boolean
}

export type ParseResult =
  | { ok: true; value: RolePatch }
  | { ok: false; error: string }

/** Lowercase, underscores, no leading/trailing separator — matches the seed. */
const KEY_RE = /^[a-z][a-z0-9_]{1,48}[a-z0-9]$/

export function normalizeRolePatch(
  body: Record<string, unknown>,
  opts: { requireKey?: boolean } = {}
): ParseResult {
  const value: RolePatch = {}

  if (opts.requireKey || body.key !== undefined) {
    const raw = typeof body.key === 'string' ? body.key.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''
    if (!KEY_RE.test(raw)) {
      return {
        ok: false,
        error:
          'A role key is lowercase letters, numbers and underscores — for example `insurance_broker`.',
      }
    }
    value.key = raw
  }

  if (opts.requireKey || body.label !== undefined) {
    const label = typeof body.label === 'string' ? body.label.trim() : ''
    if (!label) return { ok: false, error: 'A role needs a label — what a reader sees on the chip.' }
    if (label.length > 60) return { ok: false, error: 'Keep the label under 60 characters; it renders on a chip.' }
    value.label = label
  }

  if (opts.requireKey || body.role_group !== undefined) {
    const group = typeof body.role_group === 'string' ? body.role_group.trim() : ''
    if (!group) return { ok: false, error: 'A role needs a group — it is how the picker stays scannable.' }
    if (group.length > 60) return { ok: false, error: 'Keep the group name under 60 characters.' }
    value.role_group = group
  }

  if (body.extraction_hint !== undefined) {
    const hint = typeof body.extraction_hint === 'string' ? body.extraction_hint.trim() : ''
    value.extraction_hint = hint === '' ? null : hint
  }

  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order)
    if (!Number.isFinite(n)) return { ok: false, error: 'Sort order must be a number.' }
    value.sort_order = Math.round(n)
  }

  if (body.active !== undefined) value.active = body.active === true

  if (Object.keys(value).length === 0) return { ok: false, error: 'Nothing to change.' }
  return { ok: true, value }
}
