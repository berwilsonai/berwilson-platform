/**
 * Shaping a message that has to fit on a phone screen.
 *
 * ⚠ EXTRACTED FROM `./text-note` RATHER THAN COPIED INTO THE SECOND SENDER.
 * §12: a fork is hardest to see as two SIBLING MODULES written days apart,
 * because neither looks like a copy — the tell is a second module answering the
 * same question for a second source. The task reminder is exactly that second
 * module, so the eight functions both of them need live here once.
 *
 * Nothing in this file knows what a task, a meeting or a commitment is. That is
 * the line: if a helper needs a domain type, it belongs in the sender.
 */

/** About four lines on a phone. Past this it is a document, not a text. */
export const SOFT_LIMIT = 520

/**
 * Keep it to a readable length, cutting at a line break rather than mid-word.
 *
 * ⚠ IT CUTS AND SAYS SO, AND THE CALLER SUPPLIES THE SENTENCE. A truncating
 * reader with no continuation is not a reader (§12) — here the continuation is
 * the link, which is always kept. The sentence beside it is a parameter because
 * the morning note's "…more in your email" became a LIE the day the email was
 * held: §12 — a provenance line that invents a provenance is worse than none.
 *
 * ⚠ AND IT IS A BACKSTOP THAT SHOULD NEVER FIRE, which the tests record rather
 * than exercise: every section in every caller caps itself by item count, and
 * the only unbounded strings are shortened at the point of use. The property
 * worth asserting is that forty overdue tasks still produce a four-line text,
 * not that the cut works. This stays because it costs nothing and the
 * alternative, the day somebody adds an uncapped section, is a wall of text at
 * 06:45.
 */
export function clamp(body: string, moreLine: string): string {
  if (body.length <= SOFT_LIMIT) return body
  const lines = body.split('\n')
  const link = lines[lines.length - 1].startsWith('http') ? lines.pop()! : null
  let out = ''
  for (const line of lines) {
    if (out.length + line.length + 1 > SOFT_LIMIT - 40) break
    out += (out ? '\n' : '') + line
  }
  return [out, moreLine, link].filter(Boolean).join('\n')
}

/** "Steelton PSA, Fairbanks contract +3 more" */
export function nameList(items: string[], show: number): string {
  const shown = items.slice(0, show).map((i) => shorten(i, 44))
  const rest = items.length - shown.length
  return shown.join(', ') + (rest > 0 ? ` +${rest} more` : '')
}

export function shorten(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/**
 * "Mon" — the weekday a dated thing falls on.
 *
 * ⚠ TWO SHAPES OF INPUT REACH THIS AND THEY NEED OPPOSITE TREATMENT. A
 * meeting's `start` is an INSTANT (`2026-10-13T01:00:00Z`), which is Monday
 * evening in Denver and Tuesday in UTC — so it has to be read in the local
 * zone, pinned, like every other clock in the Pepper modules. A `due_date` is a
 * plain `date` column with no instant in it at all; reading that in a zone
 * behind UTC shifts it a day backwards, which is how a Monday deadline comes
 * out as Sunday. So: a timestamp is localised, a bare date is read at noon UTC
 * and left alone.
 */
export function weekdayOf(iso: string): string {
  const hasTime = iso.includes('T')
  const d = hasTime ? new Date(iso) : new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: hasTime ? 'America/Denver' : 'UTC',
  })
}

/** "1 Nov" — the form a deadline gets said out loud in. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
