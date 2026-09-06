/**
 * Validation for the `_intake.json` manifest the website form writes into each
 * deal folder.
 *
 * Hand-written rather than schema-library-driven, following the idiom of
 * src/lib/meetings/parse.ts and src/lib/investors/parse.ts (§11: no new
 * dependencies without demonstrated need).
 *
 * Deliberately tolerant of everything except a title. The manifest is written by
 * a separate codebase on a separate machine; rejecting a whole submission
 * because one optional field arrived as a number would lose a real deal. Values
 * that cannot be trusted — `sector` above all — are carried as free text and
 * cast at promotion by toSector(), exactly as email leads already are.
 */

import { LEAD_ROUTES, type LeadRoute } from '@/lib/ai/prompts/lead-triage'

export type Manifest = Record<string, unknown>

/** The manifest's file name. Its presence marks a submission as complete. */
export const MANIFEST_NAME = '_intake.json'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** One answered (or explicitly unanswered) checklist question. */
export interface ChecklistAnswer {
  answer: string | null
  provided: boolean
}

export interface DealIntake {
  title: string
  submitted_at: string | null
  route: LeadRoute
  contact: {
    name: string | null
    email: string | null
    phone: string | null
    company: string | null
  }
  deal: {
    summary: string | null
    scope: string | null
    location: string | null
    sector: string | null
    estimated_value: number | null
    bid_due_date: string | null
  }
  checklist: Record<string, ChecklistAnswer>
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function str(source: Record<string, unknown>, key: string): string | null {
  const v = source[key]
  if (typeof v === 'string') return v.trim() || null
  // A form that posts a number where a string was expected is still telling us
  // something true; coerce rather than discard.
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function num(source: Record<string, unknown>, key: string): number | null {
  const v = source[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    // Tolerate "$12,500,000" — a form field people type into.
    const cleaned = Number(v.replace(/[$,\s]/g, ''))
    if (Number.isFinite(cleaned) && v.trim() !== '') return cleaned
  }
  return null
}

function isoDate(source: Record<string, unknown>, key: string): string | null {
  const v = str(source, key)
  return v && ISO_DATE.test(v) ? v : null
}

function route(value: string | null): LeadRoute {
  const v = (value ?? '').trim().toLowerCase() as LeadRoute
  return LEAD_ROUTES.includes(v) ? v : 'unknown'
}

/**
 * Read the checklist block.
 *
 * Accepts both the documented `{ answer, provided }` shape and a bare string,
 * because a form is easy to wire the simple way and losing the answers over a
 * shape mismatch would be the worst possible failure here.
 */
function checklist(value: unknown): Record<string, ChecklistAnswer> {
  const source = obj(value)
  const out: Record<string, ChecklistAnswer> = {}

  for (const [key, raw] of Object.entries(source)) {
    if (typeof raw === 'string') {
      const answer = raw.trim() || null
      out[key] = { answer, provided: !!answer }
      continue
    }
    if (typeof raw === 'boolean') {
      out[key] = { answer: raw ? 'Yes' : 'No', provided: raw }
      continue
    }
    const entry = obj(raw)
    if (Object.keys(entry).length === 0) continue
    const answer = str(entry, 'answer') ?? str(entry, 'value') ?? str(entry, 'note')
    // `provided` is what the form asserts; an answer with no assertion still
    // counts as provided, since it plainly was.
    const provided = entry.provided === true || entry.provided === 'true' || !!answer
    out[key] = { answer, provided }
  }

  return out
}

export function parseDealIntake(
  raw: unknown
): { ok: true; value: DealIntake } | { ok: false; error: string } {
  const body = obj(raw)
  if (Object.keys(body).length === 0) {
    return { ok: false, error: 'Manifest is empty or not a JSON object.' }
  }

  const title = str(body, 'title') ?? str(obj(body.deal), 'name')
  if (!title) {
    return { ok: false, error: 'Manifest has no title — nothing to name the lead.' }
  }

  const contact = obj(body.contact)
  const deal = obj(body.deal)

  return {
    ok: true,
    value: {
      title,
      submitted_at: str(body, 'submitted_at'),
      route: route(str(body, 'route')),
      contact: {
        name: str(contact, 'name'),
        email: str(contact, 'email'),
        phone: str(contact, 'phone'),
        company: str(contact, 'company'),
      },
      deal: {
        summary: str(deal, 'summary'),
        scope: str(deal, 'scope'),
        location: str(deal, 'location'),
        sector: str(deal, 'sector'),
        estimated_value: num(deal, 'estimated_value'),
        bid_due_date: isoDate(deal, 'bid_due_date'),
      },
      checklist: checklist(body.checklist),
    },
  }
}

/** Parse manifest bytes. JSON errors come back as a message, never a throw. */
export function parseManifestBytes(
  buffer: ArrayBuffer
): { ok: true; value: DealIntake } | { ok: false; error: string } {
  let decoded: unknown
  try {
    decoded = JSON.parse(new TextDecoder().decode(buffer))
  } catch (err) {
    return {
      ok: false,
      error: `Manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  return parseDealIntake(decoded)
}
