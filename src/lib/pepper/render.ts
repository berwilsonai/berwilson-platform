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
import { mentionClause, type Mention } from './memory'

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
  // line and inform nothing. The mention count still applies: "you have been
  // waiting on this through six of my notes" is the sentence that turns a
  // waiting-on list into a chase list.
  if (c.row.side === 'them') return `${commitmentLine(c.row)}${mentionClause(c.mention) ?? ''}`

  const age = ageInDays(c.row.created_at)
  const outstanding = age !== null && age > 0 ? `, outstanding ${age}d` : ''

  // How many mornings she has already raised it. Stated only past the
  // escalation bar, so the count means something when it appears at all —
  // see mentionClause.
  const raised = mentionClause(c.mention) ?? ''

  // ⚠ WHEN THE OWNER IS THE READER, SAY SO — never print their own name back
  // at them. Rendering "Review and sign the GridEdge MNDA — extraction named:
  // Richard White" into Richard's own note produced the line "Richard White is
  // waiting", which invents a third party out of the reader. The name is not
  // information here; "this one is yours" is.
  if (c.via === 'name') {
    return `- ${c.row.what} — THIS IS ${reader.toUpperCase()}'S OWN, they took it on${dueClause(c.row.due_date)}${outstanding}${raised}`
  }
  return `- ${c.row.what}${ownerClause(c.row.owner_name)}${dueClause(
    c.row.due_date
  )}${outstanding}${raised} [sitting in their mailbox; nobody has confirmed they own it]`
}

/** "(and 12 more not listed)" — never silent truncation. */
/**
 * How many live-deal task lines reach the MODEL. The email lists them all.
 * Matches MAX_PER_SECTION in assemble.ts, which bounds the commitment sections
 * for the same reason and was measured there.
 */
const MAX_TASKS_IN_PROMPT = 12
/**
 * How many of Pepper's own changes go into the prompt.
 *
 * Her writes are reversible and individually small, so the note's job is to
 * make them NOTICEABLE rather than to enumerate them — the full list is on the
 * record's own feed. The true total rides along in the overflow line, because
 * §12's rule is that withholding from a reader means handing them the count.
 */
const MAX_CURATION_IN_PROMPT = 8

/** One line of evidence, trimmed. A whole email in the prompt is not evidence. */
function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? ''
  return line.length > 120 ? `${line.slice(0, 117)}…` : line
}

function overflow(n: number): string[] {
  return n > 0 ? [`- (and ${n} more not shown)`] : []
}

/**
 * One task, with the escalation clause a commitment already got.
 *
 * `mentions` is optional so a caller that predates this renders without it
 * rather than failing — the same shim `liveTasks` carries in ./email.
 */
function taskLine(t: DigestTask, mentions?: Map<string, Mention>): string {
  const tag = t.project_name ?? t.opportunity_name
  const why = t.why ? ` — ${t.why}` : ''
  const raised = mentionClause(mentions?.get(t.id)) ?? ''
  return `- ${t.title}${why}${dueClause(t.due_date)}${tag ? ` [${tag}]` : ''}${raised}`
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
  const task = (t: DigestTask) => taskLine(t, n.taskMentions)
  parts.push(...section('OVERDUE TASKS ASSIGNED TO THEM:', n.overdueTasks.map(task)))
  parts.push(...section('THEIR TASKS DUE THIS WEEK:', n.dueSoonTasks.map(task)))
  /**
   * ⚠ CAPPED IN THE PROMPT, UNCAPPED IN THE EMAIL, AND THE ASYMMETRY IS THE
   * POINT. This is the longest section — 38 rows on the first run — and the
   * model is asked for a note under 300 words off a prompt that already carries
   * ~13k tokens of fixed overhead. Feeding it 38 undated lines would crowd out
   * the commitments the prose is actually about, which is the same reason
   * MAX_PER_SECTION exists. The reader still sees every one: the itemised HTML
   * list under the note is deliberately uncapped (see email.ts), because a list
   * is scanned rather than read. The overflow line keeps this honest — a short
   * list that does not say it is short is a lie told every morning.
   */
  parts.push(
    ...section(
      'THEIR OPEN WORK ON LIVE DEALS (no deadline agreed — mostly obligations read out of the two of them talking, so these are what is outstanding rather than what is scheduled; the full list is itemised beneath the note):',
      [
        ...n.liveTasks.slice(0, MAX_TASKS_IN_PROMPT).map(task),
        ...overflow(Math.max(0, n.liveTasks.length - MAX_TASKS_IN_PROMPT)),
      ]
    )
  )
  parts.push(
    ...section('TODAY ON THEIR CALENDAR:', n.meetings.flatMap(meetingLines))
  )
  parts.push(...section('FALLING THROUGH THE CRACKS (portfolio-wide, shared with the other executive):', n.cracks.map(crackLine)))

  if (n.decide.total > 0) {
    parts.push('')
    parts.push(
      `DECIDE QUEUE: ${n.decide.total} items awaiting a human — ${n.decide.intake} staged from correspondence, ${n.decide.meetings} recorded meetings to file, ${n.decide.review} low-confidence extractions` +
        // Named only when there are any: a standing "0 recorded meetings" in
        // every morning note is noise that teaches the reader to skip the line.
        (n.decide.meetings > 0
          ? `, ${n.decide.meetings} recorded meeting${n.decide.meetings === 1 ? '' : 's'} not yet filed onto a deal.`
          : '.')
    )
    for (const line of n.decide.top) parts.push(`- ${line}`)
  }

  // ── What she did to the records herself ──────────────────────────────────
  //
  // ⚠ THE SECTION THAT MAKES THE WHOLE ARRANGEMENT HONEST. Pepper writes to
  // the CRM unattended (§11, Richard 10-12) and the trade for the approval gate
  // was that every change is reported each morning. Until 2026-10-15 nothing
  // reported any of them, and `field_update_proposals` — the questions she
  // raises instead of overwriting a human's figure — had no reader anywhere.
  if (n.curation.changes.length > 0) {
    const lines = n.curation.changes
      .slice(0, MAX_CURATION_IN_PROMPT)
      .map(
        (c) =>
          `- ${c.recordLabel} — ${c.fieldLabel}: ${c.from ? `was "${c.from}", now` : 'was blank, now'} "${c.to ?? '(blank)'}"` +
          (c.evidence ? ` (${firstLine(c.evidence)})` : '')
      )
    parts.push(
      ...section('WHAT I CHANGED IN THE RECORDS MYSELF:', [
        ...lines,
        ...overflow(Math.max(0, n.curation.changes.length - MAX_CURATION_IN_PROMPT)),
      ])
    )
  }

  // ⚠ ITS OWN SECTION, NOT FOLDED INTO "WHAT I CHANGED". A contact she ADDED
  // and a field she FILLED are different events, and §12's rule about one
  // quantity with one definition is why they are never counted together.
  if (n.curation.contactsAdded.length > 0) {
    const lines = n.curation.contactsAdded
      .slice(0, MAX_CURATION_IN_PROMPT)
      .map((c) => `- ${c.name}${c.company ? ` (${c.company})` : ''}`)
    parts.push(
      ...section('CONTACTS I ADDED FROM MAIL YOU REPLIED TO:', [
        ...lines,
        ...overflow(Math.max(0, n.curation.contactsAddedTotal - MAX_CURATION_IN_PROMPT)),
      ])
    )
  }

  if (n.curation.proposals.length > 0) {
    const lines = n.curation.proposals
      .slice(0, MAX_CURATION_IN_PROMPT)
      .map(
        (pr) =>
          `- ${pr.recordLabel} — ${pr.fieldLabel}: you have "${pr.current ?? '(blank)'}", the mail says "${pr.proposed ?? '(blank)'}"` +
          (pr.evidence ? ` (${firstLine(pr.evidence)})` : '')
      )
    parts.push(
      ...section('FIELDS I WILL NOT CHANGE WITHOUT YOU SAYING SO:', [
        ...lines,
        ...overflow(Math.max(0, n.curation.proposalsTotal - MAX_CURATION_IN_PROMPT)),
      ])
    )
  }

  const o = n.overnight
  parts.push('')
  parts.push(
    `WHAT THE PLATFORM DID ${n.sinceLabel.toUpperCase()}: filed ${o.threadsFiled} new threads, found ${o.commitmentsFound} new commitments, filed ${o.documentsFiled} documents, scored ${o.leadsScored} inbound leads` +
      (o.meetingsImported > 0
        ? `, and read ${o.meetingsImported} recorded meeting${o.meetingsImported === 1 ? '' : 's'}.`
        : '.')
  )
  // Said as its own sentence rather than folded into the list above, because it
  // is the only figure here that went DOWN and the reader has to be able to
  // disagree with it. The prompt is told to keep it.
  if (o.commitmentsRetired > 0) {
    parts.push(
      `AND RETIRED ${o.commitmentsRetired} obligation${o.commitmentsRetired === 1 ? '' : 's'} ` +
        `whose conversation has been silent for over six weeks — they are off the ledger, not ` +
        `deleted, and they come back if anybody writes on those threads again.`
    )
  }

  if (n.notes.length > 0) {
    parts.push('')
    parts.push('GAPS IN THIS INPUT (say these out loud at the end):')
    for (const note of n.notes) parts.push(`- ${note}`)
  }

  return parts.join('\n')
}
