import * as React from 'react'

/**
 * The brief's renderer, shared by the on-screen modal and the print/PDF view.
 *
 * Deliberately one component rather than one per surface: a brief printed for a
 * meeting must be the same document that was read on screen, and two renderers
 * of one document is two things to keep in step. Handles only what the brief
 * prompt actually emits — headings, bold, bullets, and the three severity
 * markers — so there is no markdown library to carry.
 */
export function BriefMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
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

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[CRITICAL\]|\[WATCH\]|\[INFO\])/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part === '[CRITICAL]') {
      return <span key={i} className="text-red-600 dark:text-red-400 font-semibold text-xs">[CRITICAL]</span>
    }
    if (part === '[WATCH]') {
      return <span key={i} className="text-amber-600 dark:text-amber-400 font-semibold text-xs">[WATCH]</span>
    }
    if (part === '[INFO]') {
      return <span key={i} className="text-blue-600 dark:text-blue-400 font-semibold text-xs">[INFO]</span>
    }
    return <span key={i}>{part}</span>
  })
}
