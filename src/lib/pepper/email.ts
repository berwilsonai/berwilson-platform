/**
 * Pepper's note, as an email.
 *
 * WHY EMAIL AND NOT THE CHAT SPACE. Everything else the platform says goes to
 * one room: the weekly brief, the daily digest, lead announcements, document
 * arrivals. A room is the right home for company news and the wrong one for
 * "you owe Dana the countersigned MNDA" — that is addressed to a person, and
 * the platform is tailnet-only, so the message has to stand on its own in a
 * phone's inbox with no link followed. Same reasoning the task digest was built
 * on, and the same reason it carries its list inline.
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

/** Subject and body for one person's note. */
export function renderNoteEmail(input: {
  firstName: string
  markdown: string
  owed: number
  overdueTasks: number
  decideTotal: number
  appUrl: string
  now?: Date
}): { subject: string; html: string } {
  const now = input.now ?? new Date()

  // The subject names the largest real number, because that is what decides
  // whether this gets opened on a phone. A generic "Your morning note" reads as
  // automated and is archived unread.
  //
  // ⚠ `owed` must be the TRUE count, not the number of rows the note listed.
  // The sections are capped at a dozen; a subject reading "15 commitments" over
  // a ledger of 19 is a small lie told every single morning.
  const subject =
    input.overdueTasks > 0
      ? `${input.overdueTasks} overdue — and ${input.owed} commitment${input.owed === 1 ? '' : 's'} outstanding`
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

  const link = input.appUrl
    ? `<a href="${input.appUrl}/decide" style="display:inline-block;margin-top:24px;padding:10px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Open the Decide queue</a>`
    : ''

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827;">
    <div style="font-size:18px;font-weight:700;">Good morning, ${escapeHtml(input.firstName)}</div>
    <div style="font-size:13px;color:#6b7280;margin-top:2px;">${escapeHtml(date)}</div>
    ${noteToHtml(input.markdown)}
    ${link}
    <div style="font-size:11px;color:#9ca3af;margin-top:28px;border-top:1px solid #e5e7eb;padding-top:12px;">
      Pepper · Ber Wilson. Read out of correspondence already on file — nothing here was sent on your behalf.
    </div>
  </div>`

  return { subject, html }
}
