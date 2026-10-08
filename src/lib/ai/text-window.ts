/**
 * One window of a long stored text, for an agent tool that returns it.
 *
 * ⚠ A TRUNCATING READER WITH NO CONTINUATION PARAMETER IS NOT A READER (§12).
 * `get_document_content` learned this the hard way: it returned `slice(0, 20000)`
 * and `truncated: true` with no way to ask for the rest — 8% of a 240,000-char
 * report — and the agent said "it's truncated" out loud and had nowhere to go.
 * The fix was an offset and a `find` that centres the window on a phrase.
 *
 * Extracted here because `get_meeting_content` has just acquired the same
 * problem for the same reason: until today `meetings.transcript` was only ever
 * filled by a hand-upload, and the Meet importer now writes whole exports into
 * it — 83,408 characters for one call. One definition, so the two tools cannot
 * drift into answering "how much of this did I get" differently.
 *
 * ⚠ `get_document_content` in agent-tools.ts still holds an inline copy of this
 * logic. It should call this instead; it was left alone only because another
 * session was editing that file at the time. Collapse it when next in there.
 */

export interface TextWindow {
  /** The slice to hand back, or null when there is no text at all. */
  text: string | null
  /** Present only when there IS text — a window of nothing is not a window. */
  window?: { offset: number; returned: number; total_chars: number }
  truncated?: boolean
  /** Where to resume. Absent when this window reached the end. */
  next_offset?: number
  /** Present only when `find` was asked for, so "not found" is distinguishable. */
  found?: { phrase: string; at: number } | null
  found_note?: string
}

/**
 * The window size, in characters.
 *
 * Tunable because its ceiling is the model's context window rather than a
 * preference: one window is roughly WINDOW/4 tokens, and the agent may hold
 * several at once alongside ~13k tokens of fixed overhead. Raise it WITH the LM
 * Studio context, never ahead of it (CLAUDE.md §7).
 */
export function windowChars(): number {
  return Number(process.env.AGENT_DOC_WINDOW_CHARS) || 20_000
}

export function textWindow(
  raw: string,
  args: { offset?: unknown; find?: unknown }
): TextWindow {
  const WINDOW = windowChars()
  const total = raw.length

  let start = Math.max(0, Math.floor(Number(args.offset) || 0))
  let foundAt: number | null = null
  const find = typeof args.find === 'string' ? args.find.trim() : ''
  if (find) {
    foundAt = raw.toLowerCase().indexOf(find.toLowerCase())
    // Centre the window on the hit so the surrounding clause comes with it — a
    // figure is useless without the sentence that qualifies it.
    if (foundAt >= 0) start = Math.max(0, foundAt - Math.floor(WINDOW / 4))
  }
  // An offset past the end returns the LAST window rather than nothing: the
  // agent has usually just added one window too many, and an empty result reads
  // as "there is no more text here" when there is.
  if (start >= total) start = total > 0 ? Math.max(0, total - WINDOW) : 0

  const text = raw.slice(start, start + WINDOW)
  const end = start + text.length
  const more = end < total

  return {
    text: text || null,
    ...(total > 0
      ? {
          window: { offset: start, returned: text.length, total_chars: total },
          truncated: more,
          ...(more ? { next_offset: end } : {}),
        }
      : {}),
    ...(find
      ? foundAt !== null && foundAt >= 0
        ? { found: { phrase: find, at: foundAt } }
        : { found: null, found_note: `"${find}" does not appear in this text.` }
      : {}),
  }
}
