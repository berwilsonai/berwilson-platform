import { parseProseBlocks } from '@/lib/utils/prose'
import { cn } from '@/lib/utils'

/**
 * Render a pasted plain-text document with real typographic structure.
 *
 * The parsing — and the measurement behind every rule — lives in
 * `src/lib/utils/prose.ts`, which is pure and tested. This is the skin.
 *
 * ⚠ IN `src/components`, READING A HELPER FROM `src/lib`. §12: a helper shared
 * between a server page and a client component lives in `src/lib`, never
 * exported from a `'use client'` file, or calling it from a server page throws
 * at REQUEST time with neither `tsc` nor the build catching it.
 */
export default function ProseBlocks({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const blocks = parseProseBlocks(text)
  if (!blocks.length) return null

  return (
    <div className={cn('max-w-2xl space-y-3', className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'rule':
            return <hr key={i} className="my-5 border-border" />
          case 'heading':
            return (
              <h4 key={i} className="pt-2 text-title text-foreground first:pt-0">
                {b.text}
              </h4>
            )
          case 'quote':
            return (
              <figure key={i} className="border-l-2 border-primary/40 pl-3.5">
                <blockquote className="text-sm text-foreground italic">{b.text}</blockquote>
                {b.attribution ? (
                  <figcaption className="mt-0.5 text-caption text-muted-foreground">
                    {b.attribution}
                  </figcaption>
                ) : null}
              </figure>
            )
          case 'list':
            return (
              <ul key={i} className="space-y-1">
                {b.items.map((item, j) => (
                  <li key={j} className="flex gap-2 text-sm leading-relaxed text-foreground">
                    {/* A bullet the reader cannot mistake for the accent's
                        other six jobs — and `aria-hidden`, since the list
                        semantics already say it is a list. */}
                    <span className="mt-[0.55em] size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>
            )
          default:
            return (
              <p key={i} className="text-sm leading-relaxed text-foreground">
                {b.text}
              </p>
            )
        }
      })}
    </div>
  )
}
