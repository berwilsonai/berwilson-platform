import * as React from 'react'

import { Chip } from '@/components/ui/chip'
import { SEVERITY_BADGE } from '@/lib/utils/constants'

/**
 * The brief's renderer, shared by the on-screen modal and the print/PDF view.
 *
 * Deliberately one component rather than one per surface: a brief printed for a
 * meeting must be the same document that was read on screen, and two renderers
 * of one document is two things to keep in step. Handles only what the brief
 * prompt actually emits — headings, bold, bullets, and bracketed tags — so
 * there is no markdown library to carry.
 */
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

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[A-Z]{3,}\])/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
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
