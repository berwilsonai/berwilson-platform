/**
 * Turn one person's morning into the block of text the model composes from.
 *
 * Kept apart from the assembler for the reason the digest's renderer is: what
 * the model is SHOWN should be readable and changeable without touching what is
 * gathered.
 *
 * Every figure the note is allowed to state appears here, and ABSENCE IS
 * STATED — "no date agreed", "never corresponded" — rather than left blank for
 * a helpful model to fill in. A blank reads to a human as though a date exists
 * and simply was not shown, which is the one thing a commitments list must
 * never do.
 */

import type { DigestTask } from '@/lib/tasks/queries'
import type { CommitmentRow } from '@/lib/commitments/db'
import type { AttentionItem } from '@/lib/attention'
import {
  STALE_CONTACT_DAYS,
  type MeetingContext,
  type NoteCommitment,
  type PepperNote,
} from './assemble'

function ageInDays(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

function daysUntil(date: string | null): number | null {
  if (!date) return null
  const target = new Date(`${date}T00:00:00`).getTime()
  if (!isFinite(target)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today.getTime()) / 86_400_000)
}

function dueClause(date: string | null): string {
  if (!date) return ' (no date agreed)'
  const d = daysUntil(date)
  if (d === null) return ` (due ${date})`
  if (d < 0) return ` (due ${date}, ${Math.abs(d)} DAYS OVERDUE)`
  if (d === 0) return ' (due TODAY)'
  return ` (due ${date}, in ${d}d)`
}

/**
 * The owner is quoted exactly as extraction recorded it, including when that is
 * the company's own name — a reader seeing "Ber Wilson" knows the company was
 * named and no individual was, and rewriting it to a person would be a guess.
 */
function ownerClause(ownerName: string | null): string {
  return ownerName ? ` — extraction named: ${ownerName}` : ' — no owner named'
}

function commitmentLine(c: CommitmentRow): string {
  const age = ageInDays(c.created_at)
  const outstanding = age !== null && age > 0 ? `, outstanding ${age}d` : ''
  return `- ${c.what}${ownerClause(c.owner_name)}${dueClause(c.due_date)}${outstanding}`
}

/**
 * The same line, plus WHY it is on this person's list.
 *
 * A row attributed by mailbox is on their desk because the conversation is in
 * their mail, not because anyone said they would do it — and one live row makes
 * the point: "Chat to finalize registration and payment", extraction named
 * Rachel Smith, in Richard's mailbox. Printed like a row he took on, it becomes
 * a sentence telling him he owes something somebody else promised.
 */
function attributedLine(c: NoteCommitment, reader: string): string {
  // On a waiting-on row the named person is the counterparty by definition and
  // the mailbox is the only key there is, so any caveat would be true of every
  // line and inform nothing.
  if (c.row.side === 'them') return commitmentLine(c.row)

  const age = ageInDays(c.row.created_at)
  const outstanding = age !== null && age > 0 ? `, outstanding ${age}d` : ''

  // ⚠ WHEN THE OWNER IS THE READER, SAY SO — never print their own name back
  // at them. Rendering "Review and sign the GridEdge MNDA — extraction named:
  // Richard White" into Richard's own note produced the line "Richard White is
  // waiting", which invents a third party out of the reader. The name is not
  // information here; "this one is yours" is.
  if (c.via === 'name') {
    return `- ${c.row.what} — THIS IS ${reader.toUpperCase()}'S OWN, they took it on${dueClause(c.row.due_date)}${outstanding}`
  }
  return `- ${c.row.what}${ownerClause(c.row.owner_name)}${dueClause(
    c.row.due_date
  )}${outstanding} [sitting in their mailbox; nobody has confirmed they own it]`
}

/** "(and 12 more not listed)" — never silent truncation. */
function overflow(n: number): string[] {
  return n > 0 ? [`- (and ${n} more not shown)`] : []
}

function taskLine(t: DigestTask): string {
  const tag = t.project_name ?? t.opportunity_name
  const why = t.why ? ` — ${t.why}` : ''
  return `- ${t.title}${why}${dueClause(t.due_date)}${tag ? ` [${tag}]` : ''}`
}

function meetingLines(m: MeetingContext): string[] {
  const when = m.isAllDay
    ? 'all day'
    : new Date(m.start).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Denver',
      })
  const lines = [`- ${when} — ${m.subject}${m.location ? ` (${m.location})` : ''}`]

  if (m.counterparties.length === 0) {
    lines.push('    no external attendees')
    return lines
  }

  for (const c of m.counterparties) {
    const contact =
      c.lastContactDays === null
        ? 'never corresponded'
        : c.lastContactDays === 0
          ? 'last spoke today'
          : `last spoke ${c.lastContactDays}d ago${c.lastContactDays >= STALE_CONTACT_DAYS ? ' — GONE QUIET' : ''}`
    lines.push(`    ${c.name} <${c.email}> — ${contact}`)
    for (const item of c.openItems) {
      lines.push(`      open with them (${item.side === 'us' ? 'we owe' : 'they owe'}): ${item.what}`)
    }
  }
  return lines
}

function crackLine(i: AttentionItem): string {
  const where = i.project_name && i.project_name !== 'Unknown' ? ` [${i.project_name}]` : ''
  return `- ${i.title}${where} — ${i.detail}`
}

function section(title: string, lines: string[]): string[] {
  // An empty section is omitted entirely rather than headed and left blank.
  // The prompt forbids padding and this is what stands behind that rule.
  if (lines.length === 0) return []
  return ['', title, ...lines]
}

export function renderNoteInput(n: PepperNote): string {
  const parts: string[] = []
  const today = new Date().toISOString().slice(0, 10)

  parts.push(`TODAY: ${today}`)
  parts.push(`THIS NOTE IS FOR: ${n.member.name} (${n.member.email})`)
  parts.push(`PERIOD COVERED: ${n.sinceLabel}`)

  parts.push(
    ...section(
      `WHAT ${n.member.firstName.toUpperCase()} OWES (outstanding commitments made in correspondence):`,
      [...n.owed.map((c) => attributedLine(c, n.member.firstName)), ...overflow(n.omitted.owed)]
    )
  )
  parts.push(
    ...section(
      `WHAT OTHERS OWE ${n.member.firstName.toUpperCase()} (follow-up candidates — the named person is the one being waited on):`,
      [...n.awaited.map((c) => attributedLine(c, n.member.firstName)), ...overflow(n.omitted.awaited)]
    )
  )
  parts.push(
    ...section(
      'COMPANY-LEVEL COMMITMENTS (no individual owner was named, or they came in through the front-door mailbox — these belong to nobody in particular yet):',
      [...n.sharedOwed.map(commitmentLine), ...overflow(n.omitted.sharedOwed)]
    )
  )
  parts.push(
    ...section(
      'COMPANY-LEVEL ITEMS AWAITED FROM OTHERS:',
      [...n.sharedAwaited.map(commitmentLine), ...overflow(n.omitted.sharedAwaited)]
    )
  )
  parts.push(...section('OVERDUE TASKS ASSIGNED TO THEM:', n.overdueTasks.map(taskLine)))
  parts.push(...section('THEIR TASKS DUE THIS WEEK:', n.dueSoonTasks.map(taskLine)))
  parts.push(
    ...section('TODAY ON THEIR CALENDAR:', n.meetings.flatMap(meetingLines))
  )
  parts.push(...section('FALLING THROUGH THE CRACKS (portfolio-wide, shared with the other executive):', n.cracks.map(crackLine)))

  if (n.decide.total > 0) {
    parts.push('')
    parts.push(
      `DECIDE QUEUE: ${n.decide.total} items awaiting a human — ${n.decide.intake} staged from correspondence, ${n.decide.leads} inbound bids, ${n.decide.review} low-confidence extractions.`
    )
    for (const line of n.decide.top) parts.push(`- ${line}`)
  }

  const o = n.overnight
  parts.push('')
  parts.push(
    `WHAT THE PLATFORM DID ${n.sinceLabel.toUpperCase()}: filed ${o.threadsFiled} new threads, found ${o.commitmentsFound} new commitments, filed ${o.documentsFiled} documents, scored ${o.leadsScored} inbound leads.`
  )

  if (n.notes.length > 0) {
    parts.push('')
    parts.push('GAPS IN THIS INPUT (say these out loud at the end):')
    for (const note of n.notes) parts.push(`- ${note}`)
  }

  return parts.join('\n')
}
