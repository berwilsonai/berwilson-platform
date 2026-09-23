/**
 * Turn assembled digest data into the block of text the model composes from.
 *
 * Kept separate from the assembler so what the model is shown can be read and
 * changed without touching what is gathered — and so the same data can be
 * rendered a second way later (an email body, a page) without a second query.
 *
 * Every figure the model is allowed to state appears here. The prompt forbids
 * inventing anything, and this is the only thing standing behind that: if a
 * date is absent from this block it should be absent from the digest, so
 * ABSENCE IS STATED EXPLICITLY ("no date agreed") rather than left blank for
 * the model to fill in helpfully.
 */

import type { DigestData } from './assemble'
import type { CommitmentRow } from '@/lib/commitments/db'

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

function commitmentLine(c: CommitmentRow): string {
  const who = c.owner_name ? ` — ${c.owner_name}` : ''
  const age = ageInDays(c.created_at)
  const outstanding = age !== null && age > 0 ? `, outstanding ${age}d` : ''

  // The date phrasing carries the honesty rule. "no date agreed" is written out
  // so the model repeats it instead of quietly omitting the date, which reads
  // to a human as though one exists and was simply not shown.
  const due = c.due_date
    ? (() => {
        const d = daysUntil(c.due_date)
        if (d === null) return ` (due ${c.due_date})`
        if (d < 0) return ` (due ${c.due_date}, ${Math.abs(d)} DAYS OVERDUE)`
        if (d === 0) return ` (due TODAY)`
        return ` (due ${c.due_date}, in ${d}d)`
      })()
    : ' (no date agreed)'

  return `- ${c.what}${who}${due}${outstanding}`
}

export function renderDigestInput(d: DigestData): string {
  const parts: string[] = []
  const today = new Date().toISOString().slice(0, 10)

  parts.push(`TODAY: ${today}`)
  parts.push(`PERIOD COVERED: ${d.window.label}`)
  parts.push('')

  if (d.commitmentsOwed.length > 0) {
    parts.push('COMMITMENTS BER WILSON OWES (still outstanding):')
    parts.push(...d.commitmentsOwed.map(commitmentLine))
    parts.push('')
  }

  if (d.commitmentsAwaited.length > 0) {
    parts.push('COMMITMENTS OTHERS OWE US (follow-up candidates):')
    parts.push(...d.commitmentsAwaited.map(commitmentLine))
    parts.push('')
  }

  if (d.bidsClosing.length > 0) {
    parts.push('BIDS CLOSING SOON (opportunities, NOT current work):')
    parts.push(
      ...d.bidsClosing.map((b) => {
        const n = daysUntil(b.bidDue)
        const when = n === null ? b.bidDue : n <= 0 ? `${b.bidDue} — CLOSES TODAY` : `${b.bidDue}, in ${n}d`
        return `- ${b.title}${b.company ? ` (${b.company})` : ''} — ${when}`
      })
    )
    parts.push('')
  }

  if (d.tasksDue.length > 0) {
    parts.push('TASKS DUE OR OVERDUE:')
    parts.push(
      ...d.tasksDue.map((t) => {
        const n = daysUntil(t.dueDate)
        const when = n === null ? t.dueDate : n < 0 ? `${Math.abs(n)} DAYS OVERDUE` : n === 0 ? 'due today' : `due in ${n}d`
        return `- ${t.title}${t.assignee ? ` — ${t.assignee}` : ''} (${when})`
      })
    )
    parts.push('')
  }

  if (d.meetings.length > 0) {
    parts.push("TODAY'S MEETINGS:")
    parts.push(
      ...d.meetings.map((m) => {
        const time = m.start.includes('T')
          ? new Date(m.start).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'America/Denver',
            })
          : 'all day'
        return `- ${time} — ${m.subject}${m.attendees ? ` (${m.attendees} attendees)` : ''}`
      })
    )
    parts.push('')
  }

  if (d.leads.length > 0) {
    parts.push('NEW BID INVITATIONS SCORED (nobody owns these yet):')
    parts.push(
      ...d.leads.map((l) => {
        const score = l.score !== null ? `fit ${l.score}` : 'unscored'
        const rec = l.recommendation ? `/${l.recommendation}` : ''
        const due = l.bidDue ? `, bid due ${l.bidDue}` : ', no bid date stated'
        return `- ${l.title}${l.company ? ` (${l.company})` : ''} — ${score}${rec}${due}`
      })
    )
    parts.push('')
  }

  if (d.threads.length > 0) {
    parts.push(`CORRESPONDENCE ${d.window.label.toUpperCase()}:`)
    for (const t of d.threads) {
      const tag = t.dealName ? `[${t.dealName}] ` : t.relevance === 'operational' ? '[operational] ' : ''
      parts.push(`- ${tag}${t.subject}${t.counterparty ? ` — with ${t.counterparty}` : ''}`)
      if (t.summary) parts.push(`  ${t.summary}`)
      for (const f of t.keyFacts) parts.push(`  · ${f}`)
    }
    parts.push('')
  }

  parts.push(
    `DECIDE QUEUE: ${d.decide.total} items waiting (${d.decide.intake} staged records, ${d.decide.leads} leads, ${d.decide.review} flagged matches).`
  )

  // A failure that produced no data must be stated, or it is indistinguishable
  // from a genuinely quiet day — the exact silent-outage shape this codebase has
  // repeatedly had to rediscover the hard way.
  if (d.notes.length > 0) {
    parts.push('')
    parts.push('DATA GAPS — state these at the end of the digest:')
    parts.push(...d.notes.map((n) => `- ${n}`))
  }

  return parts.join('\n')
}
