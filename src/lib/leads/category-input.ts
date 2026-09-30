/**
 * Validate and normalize a lead-category patch.
 *
 * Shared by the create and update routes so the two cannot drift — the failure
 * that shape prevents is a field validated on POST and waved through on PATCH.
 *
 * Only keys actually PRESENT in the body end up in the result, so a PATCH of
 * one field cannot blank the other fourteen. That distinction is the whole
 * contract here: `undefined` means "not mentioned", `null` means "clear it".
 */

import { LEAD_DESTINATIONS } from './categories'
import { TONE_NAMES } from '@/lib/utils/leads'

export type CategoryPatch = Record<string, unknown>

type Result = { ok: true; value: CategoryPatch } | { ok: false; error: string }

/** A key is a slug: lowercase, digits, underscores. It goes in a URL and a prompt. */
const KEY_RE = /^[a-z][a-z0-9_]{1,40}$/

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Parse the share list from either an array or a textarea's worth of lines.
 *
 * Deduplicated and lowercased, because these become Drive permission grants and
 * two spellings of one address is two grants and two notification emails.
 */
function addresses(v: unknown): string[] {
  const raw = Array.isArray(v)
    ? v.map((x) => String(x))
    : typeof v === 'string'
      ? v.split(/[\n,;]+/)
      : []
  return [
    ...new Set(
      raw
        .map((a) => a.trim().toLowerCase())
        .filter((a) => a.includes('@') && !a.includes(' '))
    ),
  ]
}

export function normalizeCategoryPatch(
  body: Record<string, unknown>,
  opts: { requireKey: boolean }
): Result {
  const out: CategoryPatch = {}

  if (opts.requireKey || 'key' in body) {
    const key = text(body.key)?.toLowerCase()
    if (!key) return { ok: false, error: 'A key is required.' }
    if (!KEY_RE.test(key)) {
      return {
        ok: false,
        error:
          'A key must start with a letter and contain only lowercase letters, digits and ' +
          'underscores — it is read by the AI and appears in links, so it has to stay stable. ' +
          'The label is the part people see and can say anything.',
      }
    }
    out.key = key
  }

  if (opts.requireKey || 'label' in body) {
    const label = text(body.label)
    if (!label) return { ok: false, error: 'A label is required — it is what people read.' }
    out.label = label
  }

  if ('destination' in body) {
    const destination = text(body.destination)
    if (!destination || !LEAD_DESTINATIONS.includes(destination as never)) {
      return {
        ok: false,
        error: `Destination must be one of: ${LEAD_DESTINATIONS.join(', ')}.`,
      }
    }
    out.destination = destination
  }

  if ('tone' in body) {
    const tone = text(body.tone)
    // Rejected rather than defaulted: a tone that is not in the palette renders
    // an unstyled chip with no error anywhere, because Tailwind only emits the
    // classes it finds in source (see TONE_BADGE).
    if (!tone || !TONE_NAMES.includes(tone)) {
      return { ok: false, error: `Tone must be one of: ${TONE_NAMES.join(', ')}.` }
    }
    out.tone = tone
  }

  if ('handoff_email' in body) {
    const email = text(body.handoff_email)?.toLowerCase() ?? null
    if (email && !email.includes('@')) {
      return { ok: false, error: 'That does not look like an email address.' }
    }
    out.handoff_email = email
  }

  if ('routing_rule' in body) out.routing_rule = text(body.routing_rule)
  if ('destination_note' in body) out.destination_note = text(body.destination_note)
  if ('drive_folder_id' in body) {
    // Tolerant of a pasted Drive URL: nobody reads a folder id out of the
    // address bar by hand, and the id is the last path segment.
    const raw = text(body.drive_folder_id)
    out.drive_folder_id = raw
      ? (raw.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? raw.replace(/\?.*$/, ''))
      : null
  }
  if ('chat_webhook_key' in body) {
    out.chat_webhook_key = text(body.chat_webhook_key)?.toUpperCase().replace(/[^A-Z0-9_]/g, '_') ?? null
  }
  if ('share_with' in body) out.share_with = addresses(body.share_with)
  if ('owner_team_member_id' in body) out.owner_team_member_id = text(body.owner_team_member_id)
  if ('publish_sheet' in body) out.publish_sheet = body.publish_sheet === true
  if ('active' in body) out.active = body.active !== false
  if ('sort_order' in body) {
    const n = Number(body.sort_order)
    if (!Number.isFinite(n)) return { ok: false, error: 'Order must be a number.' }
    out.sort_order = Math.round(n)
  }

  // A handoff lane with no address is a button that fails on press — the exact
  // failure DINO_LEAD_EMAIL produced for a year. Allowed, because a lane is
  // often created before its recipient is known, but the UI says so in place
  // and /decide blocks Accept on it rather than offering a broken action.
  return { ok: true, value: out }
}
