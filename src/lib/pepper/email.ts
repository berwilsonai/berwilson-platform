/**
 * Pepper's note, as an email.
 *
 * WHY EMAIL AND NOT THE CHAT SPACE. Everything else the platform says goes to
 * one room: the weekly brief, the daily digest, lead announcements, document
 * arrivals. A room is the right home for company news and the wrong one for
 * "you owe Dana the countersigned MNDA" — that is addressed to a person, and
 * the platform is tailnet-only, so the message has to stand on its own in a
 * phone's inbox with no link followed.
 *
 * ⚠ AND THE TASK LIST IS ITEMISED HERE BECAUSE THE DIGEST THAT CARRIED IT IS
 * GONE (2026-10-08). The Monday task digest read the SAME `fetchTasksForDigest`
 * query, for the same roster, and emailed each person the same two buckets ten
 * minutes after this note — the duplicate this file's own comment used to name
 * as precedent. The one thing it had that prose does not is the list itself, so
 * the list came here and the cron, the route and its renderer went. The reader
 * now gets it five mornings a week instead of one.
 *
 * The markdown converter here is deliberately small. The model returns a short
 * document in a format this prompt fully controls — headings, bullets, bold,
 * the occasional link — so a dependency would buy nothing and a general-purpose
 * renderer would accept far more HTML than an email body should contain.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inline marks, applied to already-escaped text. */
function inline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" style="color:#1d4ed8;text-decoration:none;">$1</a>'
    )
}

/**
 * Markdown → the narrow HTML an email client will actually render.
 *
 * No <style> block, no classes: Gmail strips the first and ignores the second,
 * so every rule is inline. Escaping happens BEFORE the marks are applied, so a
 * stray `<` in a subject line cannot open a tag.
 */
export function noteToHtml(markdown: string): string {
  const out: string[] = []
  let inList = false

  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      closeList()
      continue
    }

    const heading = line.match(/^#{1,6}\s*(.+)$/)
    if (heading) {
      closeList()
      out.push(
        `<div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;margin-top:22px;">${inline(
          escapeHtml(heading[1].trim())
        )}</div>`
      )
      continue
    }

    const bullet = line.match(/^\s*[-*•]\s+(.+)$/)
    if (bullet) {
      if (!inList) {
        out.push('<ul style="margin:8px 0 0;padding-left:18px;">')
        inList = true
      }
      out.push(
        `<li style="font-size:14px;line-height:1.5;color:#111827;margin-bottom:6px;">${inline(
          escapeHtml(bullet[1])
        )}</li>`
      )
      continue
    }

    closeList()
    out.push(
      `<p style="font-size:14px;line-height:1.55;color:#111827;margin:10px 0 0;">${inline(
        escapeHtml(line)
      )}</p>`
    )
  }
  closeList()

  return out.join('\n')
}

/** A task as the note lists it — the shape `fetchTasksForDigest` returns. */
export interface NoteTask {
  title: string
  why: string | null
  due_date: string | null
  project_name?: string | null
  opportunity_name?: string | null
}

/** Whole days a task is past due (>= 1 means overdue). */
function daysOverdue(dueDate: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dueDate + 'T00:00:00').getTime()) / 86_400_000)
}

function taskRow(t: NoteTask, now: Date): string {
  const tag = t.project_name ?? t.opportunity_name
  const days = t.due_date ? daysOverdue(t.due_date, now) : 0
  const dueLabel = t.due_date
    ? days > 0
      ? `${days}d overdue`
      : days === 0
        ? 'due today'
        : `due ${t.due_date}`
    : ''
  // Banded, not all-red: nine consecutive rows in alarm colour is red having
  // stopped signifying (§12). Overdue is red, today amber, the rest plain.
  const dueColor = days > 0 ? '#dc2626' : days === 0 ? '#d97706' : '#6b7280'

  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:14px;font-weight:600;color:#111827;">${escapeHtml(t.title)}</div>
        ${t.why ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(t.why)}</div>` : ''}
        <div style="font-size:12px;margin-top:4px;">
          <span style="color:${dueColor};font-weight:600;">${dueLabel}</span>
          ${tag ? `<span style="color:#9ca3af;"> \u00b7 ${escapeHtml(tag)}</span>` : ''}
        </div>
      </td>
    </tr>`
}

/**
 * The reader's own tasks, itemised beneath the note.
 *
 * Uncapped on purpose. The prose above is held under 300 words and its
 * commitment sections are capped at a dozen, because a model asked to narrate
 * ninety obligations writes something nobody acts on — but a LIST is scanned,
 * not read, and a task the note silently omitted is a task that does not get
 * done. Empty sections render as nothing rather than as an empty heading.
 */
function taskList(overdue: NoteTask[], dueSoon: NoteTask[], now: Date): string {
  const section = (label: string, tasks: NoteTask[]) =>
    tasks.length === 0
      ? ''
      : `
      <div style="margin-top:20px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">${label} (${tasks.length})</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">
          ${tasks.map((t) => taskRow(t, now)).join('')}
        </table>
      </div>`
  return section('Overdue', overdue) + section('Due this week', dueSoon)
}

/** One commitment, with the one-tap link minted for this note. */
export interface NoteSettleRow {
  what: string
  /** 'us' is something the reader owes; 'them' is something they are waiting on. */
  side: 'us' | 'them'
  dueDate: string | null
  /** The minted token, or null when it could not be minted for this row. */
  token: string | null
}

/**
 * The settle block — the reason this note can ever make a number go down.
 *
 * ⚠ BUILT FROM THE ROWS, NEVER FROM THE PROSE. The body above is composed by a
 * model, so there is no reliable way to attach a link to a specific obligation
 * inside it; a regex over generated prose would mis-anchor the one morning it
 * mattered and settle the wrong commitment. This is rendered from the same rows
 * the model was shown, exactly as the task list beneath it already is.
 *
 * ⚠ AND THE LINK OPENS A PAGE RATHER THAN ACTING. Gmail prefetches links and
 * the mail gateways §12 records (Proofpoint/ATP/Inky) follow every URL in every
 * message to scan it, so a GET that settled a row would be settled by a robot
 * before the reader woke up — with the reader's name on the audit row. One tap
 * here, one tap to confirm, and a scanner can open it all day for free.
 *
 * Rows whose token could not be minted are OMITTED rather than rendered dead: a
 * link that does nothing is worse than no link, because the reader taps it,
 * nothing happens, and they stop trusting the whole block.
 */
function settleList(rows: NoteSettleRow[], appUrl: string): string {
  if (!appUrl) return ''
  const live = rows.filter((r) => r.token)
  if (live.length === 0) return ''

  const item = (r: NoteSettleRow) => {
    const due = r.dueDate ? ` · due ${escapeHtml(r.dueDate)}` : ' · no date agreed'
    return `
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #e5e7eb;">
          <a href="${appUrl}/s/${r.token}" style="font-size:14px;color:#1d4ed8;text-decoration:none;font-weight:600;">${escapeHtml(
            r.what.length > 110 ? `${r.what.slice(0, 110)}…` : r.what
          )}</a>
          <div style="font-size:12px;color:#9ca3af;margin-top:2px;">${
            r.side === 'us' ? 'you owe this' : 'you are waiting on this'
          }${due}</div>
        </td>
      </tr>`
  }

  return `
    <div style="margin-top:24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">Settle in one tap (${live.length})</div>
      <p style="font-size:12px;color:#6b7280;margin:4px 0 0;">
        Tap one to mark it done, say it was never yours, or quiet it for a week. Nothing is settled until you confirm on the page.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
        ${live.map(item).join('')}
      </table>
    </div>`
}

/** Subject and body for one person's note. */
export function renderNoteEmail(input: {
  firstName: string
  markdown: string
  owed: number
  /** The reader's own tasks, itemised under the note. */
  overdue: NoteTask[]
  dueSoon: NoteTask[]
  decideTotal: number
  /** Commitments the note named, each with its one-tap link. */
  settle?: NoteSettleRow[]
  appUrl: string
  now?: Date
}): { subject: string; html: string } {
  const overdueTasks = input.overdue.length
  const now = input.now ?? new Date()

  // The subject names the largest real number, because that is what decides
  // whether this gets opened on a phone. A generic "Your morning note" reads as
  // automated and is archived unread.
  //
  // ⚠ `owed` must be the TRUE count, not the number of rows the note listed.
  // The sections are capped at a dozen; a subject reading "15 commitments" over
  // a ledger of 19 is a small lie told every single morning.
  const subject =
    overdueTasks > 0
      ? `${overdueTasks} overdue — and ${input.owed} commitment${input.owed === 1 ? '' : 's'} outstanding`
      : input.owed > 0
        ? `${input.owed} commitment${input.owed === 1 ? '' : 's'} outstanding`
        : input.decideTotal > 0
          ? `${input.decideTotal} decisions waiting on you`
          : 'Your morning note'

  const date = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Denver',
  })

  // Two destinations now that the tasks are listed here: the queue the prose is
  // about, and the task board the list is about. Both are tailnet-only, so they
  // stay conveniences — the message has to work with neither followed.
  const button = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;margin-top:24px;margin-right:8px;padding:10px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${label}</a>`
  const link = input.appUrl
    ? button(`${input.appUrl}/decide`, 'Open the Decide queue') +
      (overdueTasks + input.dueSoon.length > 0
        ? button(`${input.appUrl}/tasks`, 'Open my tasks')
        : '')
    : ''

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827;">
    <div style="font-size:18px;font-weight:700;">Good morning, ${escapeHtml(input.firstName)}</div>
    <div style="font-size:13px;color:#6b7280;margin-top:2px;">${escapeHtml(date)}</div>
    ${noteToHtml(input.markdown)}
    ${taskList(input.overdue, input.dueSoon, now)}
    ${settleList(input.settle ?? [], input.appUrl)}
    ${link}
    <div style="font-size:11px;color:#9ca3af;margin-top:28px;border-top:1px solid #e5e7eb;padding-top:12px;">
      Pepper · Ber Wilson. Read out of correspondence already on file — nothing here was sent on your behalf.
    </div>
  </div>`

  return { subject, html }
}
