import * as React from 'react'
import Link from 'next/link'

import { Chip } from '@/components/ui/chip'
import { SEVERITY_BADGE } from '@/lib/utils/constants'

/**
 * The brief's renderer, shared by the on-screen modal and the print/PDF view.
 *
 * Deliberately one component rather than one per surface: a brief printed for a
 * meeting must be the same document that was read on screen, and two renderers
 * of one document is two things to keep in step. There is no markdown library
 * to carry.
 *
 * ⚠ IT WAS WRITTEN FOR THE BRIEF PROMPT AND THEN REUSED FOR FREE-FORM CHAT.
 * `AgentChat` has rendered agent answers through this since the agent shipped,
 * and the vocabulary was headings, bold, bullets and bracketed tags — nothing
 * else. So **the executive intelligence agent could not link to the record it
 * was discussing**: `[Steelton](/projects/abc)` reached the reader as that
 * literal string, a pipe table rendered as a paragraph, and `1.` rendered as a
 * paragraph. Links, ordered lists, inline code and fenced code were added
 * 2026-10-17; the pipe TABLE was still raw until 2026-10-24, found the first
 * time a job report used one.
 *
 * ⚠ ADDITIVE ON PURPOSE. The brief prompt emits none of the new syntax, so the
 * print views render byte-identically — which matters because this component's
 * whole reason for existing is that the printed brief and the on-screen brief
 * are the same document.
 *
 * ⚠ AND A LINK MUST BE INTERNAL. An `href` the model composed is untrusted:
 * anything not starting with `/` renders as plain text, so an answer cannot
 * become a route off the box or a phishing target in a brief someone emails.
 */
/** `|---|:--:|---|` and nothing else — the line that proves a table is a table. */
function isTableSeparator(line: string | undefined): boolean {
  if (!line) return false
  const t = line.trim()
  if (!t.startsWith('|')) return false
  return /^\|[\s:|-]+\|?$/.test(t) && t.includes('-')
}

/** Split a pipe row into cells, dropping the leading and trailing delimiter. */
function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return t.split('|').map((c) => c.trim())
}

export function BriefMarkdown({
  text,
  suppressTitle = false,
}: {
  text: string
  /**
   * Drop the brief's own `# Record name` heading and the italic facts line
   * beneath it.
   *
   * The print view is a standalone document and needs its own title; the panel
   * embedded on a record page does not — there the name is already on the
   * breadcrumb, the h1 and the panel header, and the brief's heading makes it
   * a fourth.
   */
  suppressTitle?: boolean
}) {
  const lines = stripTitle(text.split('\n'), suppressTitle)
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // H1
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-base font-bold mt-4 mb-2 first:mt-0">{renderInline(line.slice(2))}</h1>)
      i++; continue
    }
    // H2
    if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-sm font-semibold mt-4 mb-1.5">{renderInline(line.slice(3))}</h2>)
      i++; continue
    }
    // H3
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-sm font-semibold mt-3 mb-1">{renderInline(line.slice(4))}</h3>)
      i++; continue
    }
    // Fenced code. Consumes to the closing fence, or to the end if the model
    // never closed it — an unterminated fence must not swallow nothing and
    // leave the backticks on screen.
    if (line.startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        body.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // the closing fence
      elements.push(
        <pre
          key={`pre-${i}`}
          className="my-2 overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 text-xs"
        >
          <code className="font-mono">{body.join('\n')}</code>
        </pre>
      )
      continue
    }
    // Ordered list. `start` is taken from the first marker so a list the model
    // begins at 3 is not silently renumbered to 1.
    if (/^\d+[.)] /.test(line)) {
      const items: React.ReactNode[] = []
      const start = Number(/^(\d+)/.exec(line)![1])
      while (i < lines.length && /^\d+[.)] /.test(lines[i])) {
        items.push(
          <li key={i} className="text-sm leading-relaxed">
            {renderInline(lines[i].replace(/^\d+[.)] /, ''))}
          </li>
        )
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} start={start} className="list-decimal pl-5 space-y-0.5 my-1.5">
          {items}
        </ol>
      )
      continue
    }
    // Pipe table.
    //
    // ⚠ ADDED 2026-10-24, AND THE DOCBLOCK ABOVE NAMED THIS AS BROKEN SINCE THE
    // AGENT SHIPPED without it ever being fixed — "a pipe table rendered as a
    // paragraph" is listed among the faults, and the 2026-10-17 round added
    // links, ordered lists and code but not this. Found again the first time a
    // JOB wrote a report: the job prompt asks for "prose and short tables" and
    // the reader got `|---|---|---|` on screen, which reads as a failed render.
    //
    // ⚠ THE GUARD IS THE SEPARATOR LINE, NOT THE PIPES. Prose contains pipes
    // ("A | B"), so a row alone must not start a table — the test is that the
    // NEXT line is a separator of dashes, colons and pipes only. §12: narrow a
    // static pattern until it has no false positives.
    if (line.trim().startsWith('|') && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line)
      i += 2 // the header and its separator
      const body: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        body.push(splitRow(lines[i]))
        i++
      }
      elements.push(
        <div key={`table-${i}`} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                {header.map((cell, c) => (
                  <th key={c} className="px-2 py-1 text-left font-semibold align-top">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r} className="border-b border-border/50 last:border-0">
                  {/* Padded to the header's width: a short row must not shift
                      the columns of the rows under it. */}
                  {Array.from({ length: header.length }, (_, c) => (
                    <td key={c} className="px-2 py-1 align-top leading-relaxed">
                      {renderInline(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }
    // Bullet
    if (line.match(/^[-*] /)) {
      const bullets: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        bullets.push(<li key={i} className="text-sm leading-relaxed">{renderInline(lines[i].replace(/^[-*] /, ''))}</li>)
        i++
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc pl-5 space-y-0.5 my-1.5">{bullets}</ul>)
      continue
    }
    // Empty line
    if (!line.trim()) {
      i++; continue
    }
    // Paragraph
    elements.push(<p key={i} className="text-sm leading-relaxed my-1.5">{renderInline(line)}</p>)
    i++
  }

  return <>{elements}</>
}

/**
 * Drop the leading `# Title` and the italic facts line under it.
 *
 * Only ever the FIRST heading, and only when it is genuinely the first content
 * — a brief that opens with a section instead keeps everything.
 */
function stripTitle(lines: string[], suppress: boolean): string[] {
  if (!suppress) return lines
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (i >= lines.length || !lines[i].startsWith('# ')) return lines
  i++
  while (i < lines.length && !lines[i].trim()) i++
  // The prompt emits a single italic line of facts directly beneath the title.
  if (i < lines.length && /^\*[^*].*\*$/.test(lines[i].trim())) i++
  return lines.slice(i)
}

/**
 * The brief's tag vocabulary.
 *
 * `[CRITICAL]`, `[WATCH]` and `[INFO]` are instructed by the prompt and map
 * onto the app's one severity palette. Anything else in the same shape is the
 * model labelling something it was told to label but given no word for —
 * `[FACT]` and `[JUDGEMENT]` are the live case. Those get a neutral chip
 * rather than being dropped: a `[JUDGEMENT]` silently stripped reads as a flat
 * assertion of fact, which is the opposite of what the instruction exists for.
 */
const TAG_TONE: Record<string, string> = {
  CRITICAL: SEVERITY_BADGE.blocker,
  WATCH: SEVERITY_BADGE.watch,
  INFO: SEVERITY_BADGE.info,
}

function tagLabel(token: string): string {
  return token.charAt(0) + token.slice(1).toLowerCase()
}

/**
 * ⚠ THE LINK ALTERNATIVE MUST PRECEDE THE TAG ALTERNATIVE. `[WATCH]` and
 * `[text](/path)` both open with a bracket; a tag pattern tried first would
 * claim the label half of a link and leave `(/path)` as loose text.
 */
const INLINE = /(\*\*[^*]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|`[^`\n]+`|\[[A-Z]{3,}\])/

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(INLINE)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    // Inline code — a column name, a flag, an id.
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)
    if (link) {
      const [, label, href] = link
      // ⚠ INTERNAL ONLY. The href came from a model, so it is untrusted input:
      // an external one is rendered as text rather than followed, which keeps
      // an answer from becoming a route off the box or a link someone clicks
      // out of an emailed brief.
      if (href.startsWith('/') && !href.startsWith('//')) {
        return (
          <Link
            key={i}
            href={href}
            className="text-primary underline underline-offset-2 hover:no-underline"
          >
            {label}
          </Link>
        )
      }
      return <span key={i}>{label}</span>
    }
    const tag = /^\[([A-Z]{3,})\]$/.exec(part)
    // A tag only counts at the head of the line or after a sentence ends.
    // Mid-sentence brackets are the author's — a citation, an acronym, a
    // parenthetical — and must survive untouched.
    if (tag && isTagPosition(parts, i)) {
      const token = tag[1]
      const tone = TAG_TONE[token]
      // A severity marker opens a bullet and is meant to be seen. An unplanned
      // provenance tag can recur three times in one paragraph, so it gets a
      // quiet micro-label instead of a chip — still there, never shouting.
      return tone ? (
        <Chip key={i} tone={tone} className="mr-1.5 align-[0.05em]">
          {tagLabel(token)}
        </Chip>
      ) : (
        <span key={i} className="label-caps mr-1 text-muted-foreground/60 align-[0.1em]">
          {token}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function isTagPosition(parts: string[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const before = parts[j]
    if (!before) continue
    return /[.:!?]\s*$/.test(before)
  }
  return true
}
