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
}: {
  options: T[]
  onPick: (option: T) => void
  placeholder?: string
  /** How many to show at once. The filter is what finds the rest. */
  limit?: number
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(autoFocus)

  const matches = useMemo(
    () => filterByWords(options, q, (o) => o.name).slice(0, limit),
    [q, options, limit]
  )

  return (
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
        /* A click on an option fires `mousedown` before this blur, which is why
           the options use `onMouseDown`; the delay covers the keyboard path. */
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
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
                  <span className="flex-1 truncate">{o.name}</span>
                  <span className="text-[11px] text-muted-foreground">{KIND_LABEL[o.kind]}</span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
