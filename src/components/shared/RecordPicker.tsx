'use client'

import { useMemo, useState } from 'react'
import { FolderKanban, Lightbulb, Factory, Search } from 'lucide-react'
import { filterByWords } from '@/lib/utils/search'

/**
 * A record somebody can be asked to choose by hand.
 *
 * `steel_deal` is here because `/api/documents/[id]/refile` accepts one, not
 * because every caller offers one — a picker that lists a destination its own
 * write would refuse is the DINO_LEAD_EMAIL failure again (§12), so the caller
 * passes the list and this renders exactly what it is given.
 */
export interface PickableRecord {
  id: string
  name: string
  kind: 'project' | 'opportunity' | 'steel_deal'
}

const KIND_ICON = {
  project: FolderKanban,
  opportunity: Lightbulb,
  steel_deal: Factory,
} as const

const KIND_LABEL = {
  project: 'project',
  opportunity: 'opportunity',
  steel_deal: 'steel deal',
} as const

/**
 * Type-ahead over the records something could be filed onto.
 *
 * ⚠ ONE COPY, BECAUSE THERE WERE TWO AND A THIRD WAS ABOUT TO BE WRITTEN.
 * `LeadDetailSheet` carried a local `RecordPicker` whose own docblock said it
 * was "the same shape as the meeting review's record picker" — two components,
 * one question, already drifting (one filtered on focus, the other only once
 * you typed). §12: grep for a renderer before building one, and wire every
 * surface that should call it afterwards.
 *
 * Deliberately a filter over a list already in memory rather than a search
 * endpoint: the whole portfolio is ~33 records, and a picker that has to
 * round-trip is one nobody waits for.
 *
 * ⚠ IT MATCHES ON ANY WORD, NOT THE WHOLE PHRASE. §12 — a keyword search that
 * only matches the phrase answers "nothing" where it means "not adjacent", and
 * the names here are the kind that provoke it: typing `cleveland steelton`
 * finds nothing against "Steelton — Cleveland-Cliffs (PA)" under a substring
 * test. Every word must appear SOMEWHERE in the name, in any order.
 */
export default function RecordPicker<T extends PickableRecord>({
  options,
  onPick,
  placeholder = 'Find the project or opportunity…',
  limit = 8,
  autoFocus = false,
  layout = 'overlay',
}: {
  options: T[]
  onPick: (option: T) => void
  placeholder?: string
  /** How many to show at once. The filter is what finds the rest. */
  limit?: number
  autoFocus?: boolean
  /**
   * Where the matches are drawn.
   *
   * ⚠ `inline` EXISTS BECAUSE AN ABSOLUTE DROPDOWN IS INVISIBLE INSIDE A
   * DIALOG. `DialogContent` carries `max-h-[calc(100dvh-2rem)] overflow-y-auto`
   * — correctly, so a long dialog scrolls — and §12 records that an overflow
   * container is a clipping container: the list rendered, in the right place,
   * and was cut off at the dialog's edge with every class correct. Caught on
   * the first driven screenshot of the /decide picker; nothing in a typecheck
   * or a build could see it.
   *
   * `overlay` stays the default because it is right where the picker sits
   * among other content and must not push it around — the lead sheet. In a
   * dialog whose whole purpose is this one choice, a list that grows the
   * dialog is both visible and better on a phone.
   */
  layout?: 'overlay' | 'inline'
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(autoFocus)
  const inline = layout === 'inline'

  const matches = useMemo(
    () => filterByWords(options, q, (o) => o.name).slice(0, limit),
    [q, options, limit]
  )

  return (
    /* ⚠ `min-w-0` ON THE ROOT, not only on the list inside it. `DialogContent`
       is a grid, and a grid item's default `min-width:auto` is its own
       min-content — so the longest record name made THIS div wider than the
       dialog, which then overflowed its own padding and clipped the heading
       above it. Every class on the list was already correct. */
    <div className="relative min-w-0">
      {/* ⚠ THE ICON IS ANCHORED TO THE INPUT, NOT TO THE WHOLE PICKER. It was
          `absolute … top-1/2` against the root, which is correct only while
          the root contains nothing but the input: with the list rendered
          INLINE below it, "half way down" became half way down input + list,
          and the magnifier drew itself under the field. A wrapper per
          positioning context, rather than a second set of offsets to keep in
          step with whatever the list does next. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder={placeholder}
          value={q}
          autoFocus={autoFocus}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          /* A click on an option fires `mousedown` before this blur, which is
             why the options use `onMouseDown`; the delay covers the keyboard
             path. An inline list is always shown, so it never closes on blur. */
          onBlur={inline ? undefined : () => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {(inline || open) && (
        <div
          className={
            inline
              ? 'mt-2 max-h-72 min-w-0 overflow-y-auto rounded-md border border-border bg-card'
              : 'absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card shadow-lg'
          }
        >
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No record matches that.</p>
          ) : (
            matches.map((o) => {
              const Icon = KIND_ICON[o.kind]
              return (
                <button
                  key={`${o.kind}-${o.id}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onPick(o)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {/* ⚠ `min-w-0` OR `truncate` DOES NOTHING HERE. A flex child's
                      default `min-width:auto` is its content, so the longest
                      record name — "Alaska Golden Summit / True North Gold &
                      Geologic Hydrogen JV" — pushed the list wider than the
                      dialog containing it and took the dialog's own heading off
                      the right edge with it. */}
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {KIND_LABEL[o.kind]}
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
