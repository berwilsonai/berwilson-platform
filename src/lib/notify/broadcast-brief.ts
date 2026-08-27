/**
 * Deliver the morning brief to the Google Chat space.
 *
 * The brief has been generated every morning since it shipped and read by
 * nobody: the cron's own docstring says it stores the brief "for viewing at
 * /briefs", and there is no /briefs page. It has been writing to a table with
 * no reader for weeks.
 *
 * A shared Chat space is the right home for it — it is one message a day to a
 * room the whole team is already in, including everyone who cannot reach the
 * platform at all. That is precisely the audience the brief was written for and
 * has never once reached.
 *
 * Best-effort by construction: the brief is already safely stored before this
 * runs, so a Chat outage costs the delivery and nothing else.
 */

import { isChatConfigured } from './chat'
import { notify } from './index'

/**
 * Markdown → Google Chat's own small dialect.
 *
 * Chat is NOT markdown: `**bold**` renders literally, `##` headings render
 * literally, and the result reads like someone pasted a file into a chat
 * window. Its actual syntax is `*bold*`, `_italic_`, and `<url|label>`.
 *
 * Separate from htmlToChatText because the input is genuinely a different
 * language — that one converts email bodies, this one converts model output.
 */
export function markdownToChatText(md: string): string {
  return (
    md
      // Headings become bold lines. Done before bold, so a heading containing
      // `**` does not end up double-marked.
      .replace(/^#{1,6}\s*(.+?)\s*$/gm, (_m, text) => `*${String(text).replace(/\*\*/g, '')}*`)
      // Bold: `**x**` and `__x__` both collapse to Chat's single asterisk.
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      .replace(/__(.+?)__/g, '*$1*')
      // Links: [label](url) → <url|label>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
      // Bullets: normalise -, *, + to a real bullet. The leading-space capture
      // preserves nesting, which the brief uses for sub-points.
      .replace(/^(\s*)[-*+]\s+/gm, '$1• ')
      // Horizontal rules are noise in a chat message.
      .replace(/^\s*([-*_])\1{2,}\s*$/gm, '')
      .replace(/`{3}[a-z]*\n?/gi, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * Chat rejects oversized messages outright, and a brief that fails to post is
 * worse than one that arrives with its tail trimmed.
 */
const MAX_CHAT_CHARS = 3800

export interface BroadcastResult {
  ok: boolean
  skipped?: boolean
  error?: string
}

export async function broadcastBrief(title: string, markdown: string): Promise<BroadcastResult> {
  if (!isChatConfigured()) return { ok: false, skipped: true }

  let text = markdownToChatText(markdown)
  if (text.length > MAX_CHAT_CHARS) {
    text = `${text.slice(0, MAX_CHAT_CHARS).trimEnd()}\n\n_…trimmed. Open Ber Intelligence for the full brief._`
  }

  const res = await notify({
    channel: 'chat',
    to: 'brief',
    subject: title,
    html: '',
    text,
    // One thread per day, so the space shows a running series of mornings
    // rather than a flat wall that buries yesterday.
    threadKey: `brief-${new Date().toISOString().slice(0, 10)}`,
  })

  return { ok: res.ok, error: res.error }
}
