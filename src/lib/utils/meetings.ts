/**
 * Constants + helpers for the Meetings module — the durable record of board /
 * governance meetings (company scope) and per-project client interactions
 * (project scope). Kind/status/scope are plain text in the DB (no Postgres
 * enums), so this file is the source of truth for allowed values + labels.
 *
 * Date handling stays on 'YYYY-MM-DD' strings (meeting_date is date-only) to
 * sidestep the UTC-midnight bug class — never `new Date('YYYY-MM-DD')`.
 */

// ─── Kind (what sort of meeting) ─────────────────────────────────────────────

export type MeetingKind = 'board' | 'client' | 'site_visit' | 'call' | 'internal' | 'other'

export const MEETING_KINDS: MeetingKind[] = ['board', 'client', 'site_visit', 'call', 'internal', 'other']

/** Kinds offered on the company Board register (governance). */
export const BOARD_KINDS: MeetingKind[] = ['board', 'internal', 'other']

/** Kinds offered on a project's Meetings tab (client interactions). */
export const PROJECT_KINDS: MeetingKind[] = ['client', 'call', 'site_visit', 'internal', 'other']

/** Kinds offered on an opportunity's Meetings section (deal interactions). */
export const OPPORTUNITY_KINDS: MeetingKind[] = ['client', 'call', 'site_visit', 'internal', 'other']

export const MEETING_KIND_LABELS: Record<MeetingKind, string> = {
  board: 'Board Meeting',
  client: 'Client Meeting',
  site_visit: 'Site Visit',
  call: 'Call',
  internal: 'Internal',
  other: 'Other',
}

export const MEETING_KIND_BADGE: Record<MeetingKind, string> = {
  board: 'bg-primary/10 text-primary ring-primary/20 dark:bg-primary/15 dark:text-primary dark:ring-primary/30',
  client: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800/60',
  site_visit: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/60',
  call: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-800/60',
  internal: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800/60',
  other: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
}

export function meetingKind(value: string | null | undefined): MeetingKind {
  return MEETING_KINDS.includes(value as MeetingKind) ? (value as MeetingKind) : 'other'
}

export function meetingKindLabel(value: string | null | undefined): string {
  return MEETING_KIND_LABELS[meetingKind(value)]
}

// ─── Scope ───────────────────────────────────────────────────────────────────

export type MeetingScope = 'company' | 'project' | 'opportunity'

export function meetingScope(value: string | null | undefined): MeetingScope {
  if (value === 'company') return 'company'
  if (value === 'opportunity') return 'opportunity'
  return 'project'
}

export function isBoard(scope: string | null | undefined): boolean {
  return scope === 'company'
}

// ─── Status (approval workflow) ──────────────────────────────────────────────

export type MeetingStatus = 'draft' | 'approved'

export const MEETING_STATUSES: MeetingStatus[] = ['draft', 'approved']

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
}

export const MEETING_STATUS_BADGE: Record<MeetingStatus, string> = {
  draft: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/60',
}

export function meetingStatus(value: string | null | undefined): MeetingStatus {
  return value === 'approved' ? 'approved' : 'draft'
}

// ─── Attendees (jsonb) ───────────────────────────────────────────────────────

export interface MeetingAttendee {
  name: string
  role: string | null
  org: string | null
  /** Linked directory contact (parties.id) — set when picked from Contacts or a
   *  team member with a linked contact. Drives the contact-profile activity log. */
  party_id: string | null
  /** Linked Ber Wilson team member (team_members.id) — set when picked from the team. */
  team_member_id: string | null
}

function optStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Coerce arbitrary jsonb/body input into a clean attendee list (drops blanks). */
export function parseAttendees(value: unknown): MeetingAttendee[] {
  if (!Array.isArray(value)) return []
  const out: MeetingAttendee[] = []
  for (const item of value) {
    const o = (item ?? {}) as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!name) continue
    out.push({
      name,
      // accept `title` as an alias for role (the meeting-intake shape uses title)
      role: optStr(o.role) ?? optStr(o.title),
      org: optStr(o.org) ?? optStr(o.company),
      party_id: optStr(o.party_id),
      team_member_id: optStr(o.team_member_id),
    })
  }
  return out
}

/** Coerce arbitrary jsonb/body input into a clean decisions list (drops blanks). */
export function parseDecisions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((d) => (typeof d === 'string' ? d.trim() : ''))
    .filter((d): d is string => d.length > 0)
}

// ─── Compose the markdown minutes document (record + optional Ber AI index) ───

/** Shape the record-to-document composer reads (a subset of the meetings row). */
export interface MeetingDocInput {
  title: string
  kind: string | null
  meeting_date: string
  meeting_time?: string | null
  location?: string | null
  meeting_type_label?: string | null
  chair?: string | null
  secretary?: string | null
  attendees: unknown
  summary?: string | null
  minutes?: string | null
  decisions: unknown
  status?: string | null
}

/**
 * Compose a self-contained markdown document from a meeting record — used both
 * as the downloadable/preserved copy and (when index_ai is on) as the text
 * embedded for Ber AI. Mirrors the meeting-intake `meetingDoc()` shape.
 */
export function composeMeetingDocument(m: MeetingDocInput): string {
  const lines: string[] = [`# ${m.title}`, '']

  const meta: string[] = []
  if (m.meeting_type_label) meta.push(m.meeting_type_label)
  meta.push(meetingKindLabel(m.kind))
  lines.push(`*${meta.join(' · ')}*`, '')

  const facts: string[] = [`**Date:** ${m.meeting_date}`]
  if (m.meeting_time) facts.push(`**Time:** ${m.meeting_time}`)
  if (m.location) facts.push(`**Location:** ${m.location}`)
  if (m.chair) facts.push(`**Chair:** ${m.chair}`)
  if (m.secretary) facts.push(`**Secretary:** ${m.secretary}`)
  if (m.status) facts.push(`**Status:** ${MEETING_STATUS_LABELS[meetingStatus(m.status)]}`)
  lines.push(facts.join('  \n'), '')

  const attendees = parseAttendees(m.attendees)
  if (attendees.length) {
    lines.push('## Attendees', '')
    for (const a of attendees) {
      const detail = [a.role, a.org].filter(Boolean).join(', ')
      lines.push(`- ${a.name}${detail ? ` — ${detail}` : ''}`)
    }
    lines.push('')
  }

  if (m.summary) lines.push('## Summary', '', m.summary, '')

  const decisions = parseDecisions(m.decisions)
  if (decisions.length) {
    lines.push('## Decisions', '')
    for (const d of decisions) lines.push(`- ${d}`)
    lines.push('')
  }

  if (m.minutes) lines.push('## Minutes', '', m.minutes, '')

  return lines.join('\n').trim() + '\n'
}

// ─── Recording upload ────────────────────────────────────────────────────────

/**
 * `accept` for the meeting-recording file inputs.
 *
 * The wildcards alone are NOT enough. A browser expands `audio/*` into a set of
 * file types via its own MIME→extension table, and that expansion is where the
 * macOS/iOS file picker decides what to grey out — mp3 was being rejected at the
 * picker even though nothing server-side objects (the `documents` bucket is
 * unrestricted) and afconvert decodes it fine. Literal extensions bypass the
 * expansion entirely, so they are the reliable half of this list.
 *
 * Keep this to containers `afconvert` can actually decode (see `afconvert -hf`)
 * — offering a file the transcription pipeline will choke on is worse than
 * greying it out.
 */
export const RECORDING_ACCEPT = [
  'audio/*',
  'video/*',
  // audio containers
  '.mp3', '.m4a', '.m4b', '.wav', '.aac', '.adts', '.aif', '.aiff', '.aifc', '.caf', '.flac', '.amr', '.ac3',
  // video containers (afconvert reads the audio track)
  '.mp4', '.m4v', '.mov', '.3gp',
].join(',')
