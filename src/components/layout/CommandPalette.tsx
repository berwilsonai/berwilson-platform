'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  Search,
  CornerDownLeft,
  FolderKanban,
  Lightbulb,
  Users,
  Building2,
  ArrowRight,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { SearchResult } from '@/app/api/search/route'
import { NAV_ITEMS, PALETTE_EXTRAS } from '@/lib/nav'

// Static destinations — always searchable, shown when the query is short.
// Derived from the single nav source plus palette-only extras.
const PAGES: { href: string; label: string; keywords: string }[] = [
  ...NAV_ITEMS.map((i) => ({ href: i.href, label: i.title ?? i.label, keywords: i.keywords })),
  ...PALETTE_EXTRAS,
]

const TYPE_META: Record<SearchResult['type'], { icon: LucideIcon; label: string }> = {
  project: { icon: FolderKanban, label: 'Project' },
  opportunity: { icon: Lightbulb, label: 'Opportunity' },
  contact: { icon: Users, label: 'Contact' },
  vendor: { icon: Building2, label: 'Vendor' },
}

type Item =
  | { kind: 'ask' }
  | { kind: 'page'; href: string; label: string }
  | { kind: 'entity'; result: SearchResult }

const MIN_QUERY = 2

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)

  const term = query.trim()
  const searchable = term.length >= MIN_QUERY

  // Filtered static pages.
  const pages = useMemo(() => {
    const t = term.toLowerCase()
    if (!t) return PAGES
    return PAGES.filter((p) => p.label.toLowerCase().includes(t) || p.keywords.includes(t))
  }, [term])

  // Only show fetched records once the query is long enough to have triggered a search.
  const visibleResults = useMemo(() => (searchable ? results : []), [searchable, results])

  // Flat list used for keyboard navigation + indexing. "Ask Ber AI" is always first.
  const items: Item[] = useMemo(() => {
    const list: Item[] = [{ kind: 'ask' }]
    for (const p of pages) list.push({ kind: 'page', href: p.href, label: p.label })
    for (const r of visibleResults) list.push({ kind: 'entity', result: r })
    return list
  }, [pages, visibleResults])

  // Clamp the active index at read-time so a shrinking list never points out of range.
  const activeIdx = items.length ? Math.min(active, items.length - 1) : 0

  // Debounced entity search. setState only happens inside the async timeout, never
  // synchronously in the effect body.
  useEffect(() => {
    if (!searchable) return
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        const json = await res.json()
        setResults(json.results ?? [])
      } catch {
        /* aborted or failed — ignore */
      } finally {
        setLoading(false)
      }
    }, 180)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [term, searchable])

  // Focus the input on mount (palette is mounted fresh each time it opens).
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])

  const go = useCallback(
    (href: string) => {
      onClose()
      router.push(href)
    },
    [onClose, router]
  )

  // Hand the current query to the ambient Ask Ber AI dock.
  const runAsk = useCallback(() => {
    onClose()
    window.dispatchEvent(new CustomEvent('open-ber-ai', { detail: { query: term } }))
  }, [onClose, term])

  const activate = useCallback(
    (item: Item) => {
      if (item.kind === 'ask') runAsk()
      else go(item.kind === 'page' ? item.href : item.result.href)
    },
    [go, runAsk]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (items.length ? (Math.min(a, items.length - 1) + 1) % items.length : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) =>
          items.length ? (Math.min(a, items.length - 1) - 1 + items.length) % items.length : 0
        )
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = items[activeIdx]
        if (item) activate(item)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [items, activeIdx, activate, onClose]
  )

  // Scroll the active row into view (no state — DOM interaction only).
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  let idx = -1

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 sm:pt-[12vh]">
      {/* Backdrop */}
      <button
        aria-label="Close search"
        className="absolute inset-0 bg-foreground/30 backdrop-blur-sm animate-fade-in-up"
        style={{ animationDuration: '0.15s' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Command palette"
        className="relative w-full max-w-xl overflow-hidden rounded-xl bg-popover text-popover-foreground ring-1 ring-foreground/10 elev-3 animate-fade-in-up"
        style={{ animationDuration: '0.18s' }}
        onKeyDown={onKeyDown}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-border">
          <Search size={18} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            placeholder="Search projects, people, vendors, pages…"
            className="flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto scrollbar-thin py-2">
          {/* Ask Ber AI — always first */}
          <div className="px-2">
            {(() => {
              idx++
              const i = idx
              const isActive = i === activeIdx
              return (
                <button
                  data-idx={i}
                  onClick={runAsk}
                  onMouseMove={() => setActive(i)}
                  className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors ${
                    isActive ? 'bg-accent text-foreground' : 'text-foreground/80'
                  }`}
                >
                  <Sparkles size={14} className="text-primary shrink-0" />
                  <span className="text-sm flex-1 truncate">
                    Ask Ber AI{term ? (
                      <>
                        : <span className="text-muted-foreground">&ldquo;{term}&rdquo;</span>
                      </>
                    ) : '…'}
                  </span>
                  {isActive && <CornerDownLeft size={13} className="text-muted-foreground shrink-0" />}
                </button>
              )
            })()}
          </div>

          {/* Pages */}
          {pages.length > 0 && (
            <div className="px-2">
              <p className="px-2 py-1 label-caps text-muted-foreground">
                Pages
              </p>
              {pages.map((p) => {
                idx++
                const i = idx
                const isActive = i === activeIdx
                const current = pathname === p.href || pathname.startsWith(p.href + '/')
                return (
                  <button
                    key={p.href}
                    data-idx={i}
                    onClick={() => go(p.href)}
                    onMouseMove={() => setActive(i)}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors ${
                      isActive ? 'bg-accent text-foreground' : 'text-foreground/80'
                    }`}
                  >
                    <ArrowRight size={14} className="text-muted-foreground shrink-0" />
                    <span className="text-sm flex-1 truncate">{p.label}</span>
                    {current && <span className="text-[10px] text-muted-foreground">Current</span>}
                    {isActive && <CornerDownLeft size={13} className="text-muted-foreground shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}

          {/* Entities */}
          {visibleResults.length > 0 && (
            <div className="px-2 mt-1">
              <p className="px-2 py-1 label-caps text-muted-foreground">
                Records
              </p>
              {visibleResults.map((r) => {
                idx++
                const i = idx
                const isActive = i === activeIdx
                const meta = TYPE_META[r.type]
                const Icon = meta.icon
                return (
                  <button
                    key={`${r.type}-${r.id}`}
                    data-idx={i}
                    onClick={() => go(r.href)}
                    onMouseMove={() => setActive(i)}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors ${
                      isActive ? 'bg-accent text-foreground' : 'text-foreground/80'
                    }`}
                  >
                    <Icon size={15} className="text-muted-foreground shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm truncate">{r.title}</span>
                      {r.subtitle && (
                        <span className="block text-xs text-muted-foreground truncate capitalize">
                          {r.subtitle}
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{meta.label}</span>
                    {isActive && <CornerDownLeft size={13} className="text-muted-foreground shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}

          {/* Empty / loading states */}
          {searchable && !loading && visibleResults.length === 0 && pages.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No matches for &ldquo;{term}&rdquo;
            </p>
          )}
          {loading && <p className="px-4 py-3 text-center text-xs text-muted-foreground">Searching…</p>}
        </div>

        {/* Footer hint */}
        <div className="hidden sm:flex items-center gap-4 px-4 h-9 border-t border-border text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1 py-px">↑</kbd>
            <kbd className="rounded border border-border bg-muted px-1 py-px">↓</kbd>
            to navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1 py-px">↵</kbd>
            to open
          </span>
        </div>
      </div>
    </div>
  )
}
