'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, RefreshCw, EyeOff, Eye } from 'lucide-react'
import { Panel } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/shared/EmptyState'
import LeadCard from './LeadCard'
import LeadDetailSheet, { type AttachOption } from './LeadDetailSheet'
import { categoryLookup, leadNeedsWork, leadClosingSoon, type LeadCategoryView } from '@/lib/utils/leads'
import { formatValue } from '@/lib/utils/constants'
import type { LeadRow, LeadNote } from '@/lib/leads/db'

type RouteFilter = string

/**
 * Put the chosen division in the address bar, so the view can be bookmarked.
 *
 * Module scope, not the component body: it needs nothing but its argument, and
 * a helper defined inside the body destabilises what it is passed to (§12).
 */
function syncRouteToUrl(route: string): void {
  const url = new URL(window.location.href)
  if (route === 'all') url.searchParams.delete('route')
  else url.searchParams.set('route', route)
  // ?lead is consumed once, on mount. Left in place, a bookmark taken after
  // following a digest link would reopen a sheet the reader has since closed.
  url.searchParams.delete('lead')
  window.history.replaceState(null, '', url)
}

/**
 * The inbound lead queue.
 *
 * Everything filters in memory — the server ships the open queue plus filtered
 * rows in one go, and the volume (a quarter of one inbox) is small enough that
 * a round trip per tab would be pure latency.
 *
 * The division tab is nonetheless kept in the URL as `?route=<key>`, because a
 * view somebody wants to return to is a view they want to bookmark: "the Dino
 * HVAC leads" was a tab you could reach but not link to, which reads as the
 * division having no page at all. Written with `history.replaceState` rather
 * than `router.replace` deliberately — the latter re-runs the server component
 * and would reintroduce exactly the round trip per tab this design avoids.
 */
export default function LeadsClient({
  initialLeads,
  filteredCount,
  initialOpenLeadId = null,
  initialRoute = 'all',
  attachOptions = [],
  categories,
}: {
  initialLeads: LeadRow[]
  filteredCount: number
  /** From ?lead=<id> — the digest email links straight to one lead. */
  initialOpenLeadId?: string | null
  /** From ?route=<key> — a bookmark or a link that opens one division. */
  initialRoute?: string
  /** Existing projects and opportunities a lead can be attached to. */
  attachOptions?: AttachOption[]
  /** The routing registry, in display order. Server-loaded; see category-view.ts. */
  categories: LeadCategoryView[]
}) {
  const router = useRouter()
  const [leads, setLeads] = useState(initialLeads)
  const [route, setRoute] = useState<RouteFilter>(initialRoute)
  const [query, setQuery] = useState('')
  /**
   * Which slice of the queue is on screen.
   *
   * ⚠ `working` IS THE DEFAULT AND THAT IS THE WHOLE POINT OF THIS SCREEN NOW.
   * Until 10-22 the default was every lead that was not spam — measured that
   * day, 600 rows, of which 9 actually needed a human and the other ~591 were
   * `ignored` or `expired`, i.e. decided history. Leads moved off /decide in
   * the same change and gained a sidebar badge counting the 9, so a default
   * view of 600 would have put a badge reading 9 above a list of 600 — the
   * §12 failure where one screen carried three numbers for one quantity (1,
   * 99+ and 197) and the reader stopped trusting all three.
   *
   * `all` is still one click away, because a decided lead is evidence and the
   * triage has to be auditable — that was the documented reason (09-15) for
   * keeping ignored rows rather than deleting them.
   */
  const [view, setView] = useState<'working' | 'all' | 'filtered'>('working')
  // Seeded from the URL so a link in the digest email lands on the lead itself
  // rather than on the queue, leaving the reader to find it again.
  const deepLinked = initialOpenLeadId
    ? (initialLeads.find((l) => l.id === initialOpenLeadId) ?? null)
    : null
  const [selected, setSelected] = useState<LeadRow | null>(deepLinked)
  const [sheetOpen, setSheetOpen] = useState(!!deepLinked)
  const [sweeping, setSweeping] = useState(false)
  // Server-supplied, then maintained locally so deleting a filtered row does
  // not leave the toggle advertising a count that is no longer true.
  const [filtered, setFiltered] = useState(filteredCount)
  const cat = useMemo(() => categoryLookup(categories), [categories])

  /**
   * Which lanes get a tab.
   *
   * Active categories, plus any RETIRED one that still owns a lead in view —
   * otherwise the tab counts do not add up to the "All" count and the leads in a
   * closed lane become unreachable, which is how a lane gets quietly abandoned
   * with work still in it.
   */
  const tabs = useMemo(() => {
    const occupied = new Set(leads.filter((l) => l.status !== 'spam').map((l) => l.route))
    return categories.filter((c) => c.active || occupied.has(c.key)).map((c) => c.key)
  }, [categories, leads])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return leads.filter((l) => {
      // Spam is its own view and never leaks into the other two.
      if (view === 'filtered' ? l.status !== 'spam' : l.status === 'spam') return false
      if (view === 'working' && !leadNeedsWork(l)) return false
      if (route !== 'all' && l.route !== route) return false
      if (!q) return true
      return [l.title, l.sender_company, l.sender_name, l.summary, l.location]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    })
  }, [leads, route, query, view])

  /**
   * Per-division counts for the tab row.
   *
   * ⚠ COUNTED OVER THE SLICE CURRENTLY SHOWN, not over everything-but-spam. A
   * tab row whose numbers add up to 600 above a list of 9 is the same
   * one-quantity-two-numbers bug as the stat band below, one control over —
   * and §12 is explicit that the totals above a filtered list are part of the
   * list. The `route` filter is deliberately NOT applied here, or every tab
   * but the selected one would read zero.
   */
  const counts = useMemo(() => {
    const slice = leads.filter((l) =>
      view === 'filtered' ? l.status === 'spam' : view === 'working' ? leadNeedsWork(l) : l.status !== 'spam'
    )
    const map: Record<string, number> = { all: slice.length }
    for (const r of tabs) map[r] = slice.filter((l) => l.route === r).length
    return map
  }, [leads, tabs, view])

  // Captured once at mount rather than read during render — "now" moving under
  // a memo is exactly the impurity the React Compiler rejects.
  // Other opportunities from the same email. Computed from the list already
  // loaded rather than fetched: one email's leads are all in it by definition.
  const siblings = useMemo(() => {
    if (!selected?.thread_id) return []
    return leads.filter((l) => l.thread_id === selected.thread_id && l.id !== selected.id)
  }, [leads, selected])

  const [notes, setNotes] = useState<LeadNote[]>([])

  /**
   * Load a lead's activity when it is opened.
   *
   * Deliberately in the open handler rather than an effect in the sheet: the
   * sheet stays presentational, and this avoids adding to the documented
   * set-state-in-effect lint debt.
   */
  async function openLead(l: LeadRow) {
    setSelected(l)
    setSheetOpen(true)
    setNotes([])
    try {
      const res = await fetch(`/api/leads/${l.id}/notes`)
      if (!res.ok) return
      const data = await res.json()
      // Ignore a response that lost its race with a faster second click.
      setNotes(data.notes ?? [])
    } catch {
      /* the feed is context, never the point of the screen */
    }
  }

  const [mountedAt] = useState(() => Date.now())

  /**
   * The band above the queue — all four tiles over the leads that still NEED
   * WORKING, which is the quantity the sidebar badge shows.
   *
   * ⚠ IT USED TO READ `status !== 'spam'` AND THAT WAS TWO BUGS. First, it
   * counted ~600 leads as "Open" when 9 were undecided, so the figure named a
   * mailbox rather than a workload. Second — and worse — "Closing ≤7d" was
   * computed over that same set, so it counted bid dates on leads somebody had
   * already IGNORED or let EXPIRE: an urgency figure made of decisions already
   * taken, which is noise that argues with the facts (§12).
   *
   * `leadNeedsWork` and `leadClosingSoon` are imported, not written here. They
   * are the same two functions `countLeadsNeedingWork` selects with for the
   * badge, so the number in the sidebar and the number on this screen cannot
   * come to disagree — which is precisely how /decide's badge once read 68
   * against a page holding 238.
   */
  const stats = useMemo(() => {
    const working = leads.filter(leadNeedsWork)
    return {
      count: working.length,
      value: working.reduce((sum, l) => sum + (l.estimated_value ?? 0), 0),
      pursue: working.filter((l) => l.fit_recommendation === 'pursue').length,
      closingSoon: working.filter((l) => leadClosingSoon(l, mountedAt)).length,
    }
  }, [leads, mountedAt])

  function replaceLead(updated: LeadRow | null) {
    if (!updated) {
      // Promoted / forwarded — it has left the open queue.
      if (selected) setLeads((prev) => prev.filter((l) => l.id !== selected.id))
      setSelected(null)
      return
    }
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
    setSelected(updated)
  }

  /**
   * Discard a lead straight from the queue. Most are decidable from the
   * headline, so there is no confirm step — that friction is the reason the
   * control exists. The row goes immediately and comes back if the server
   * refuses, so a failure is never silent.
   */
  async function deleteLead(lead: LeadRow) {
    setLeads((prev) => prev.filter((l) => l.id !== lead.id))
    if (lead.status === 'spam') setFiltered((n) => Math.max(0, n - 1))
    if (selected?.id === lead.id) {
      setSheetOpen(false)
      setSelected(null)
    }
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Could not delete the lead.')
      }
      toast.success('Lead deleted.')
    } catch (err) {
      setLeads((prev) => (prev.some((l) => l.id === lead.id) ? prev : [lead, ...prev]))
      if (lead.status === 'spam') setFiltered((n) => n + 1)
      toast.error(err instanceof Error ? err.message : 'Could not delete the lead.')
    }
  }

  async function runSweep() {
    setSweeping(true)
    toast.info('Reading info@ — triage and scoring run on the local model, so this takes a few minutes.')
    try {
      const res = await fetch('/api/leads/sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgetMs: 8 * 60 * 1000 }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Sweep failed.')
      const found = json.triage?.leads ?? 0
      const rejected = json.triage?.rejected ?? 0
      toast.success(`${found} lead(s) found, ${rejected} filtered, ${json.score?.scored ?? 0} scored.`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sweep failed.')
    } finally {
      setSweeping(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Stat band */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          // ⚠ "Open leads" NAMED NOTHING — it was every lead that was not spam,
          // including every one already decided. This tile is now the same
          // number as the sidebar badge, and the label says which question it
          // answers (§12 — two different quantities must be named apart).
          { label: 'Needs working', value: String(stats.count) },
          { label: 'Est. value', value: formatValue(stats.value) },
          { label: 'Worth pursuing', value: String(stats.pursue) },
          { label: 'Closing ≤7d', value: String(stats.closingSoon) },
        ].map((s) => (
          <Panel key={s.label} className="p-3">
            <p className="label-caps text-muted-foreground">{s.label}</p>
            <p className="tnum mt-0.5 text-xl font-semibold">{s.value}</p>
          </Panel>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {['all', ...tabs].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRoute(r)
                syncRouteToUrl(r)
              }}
              className={`h-8 rounded-md px-2.5 text-sm ${
                route === r ? 'bg-card text-foreground font-medium elev-1' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r === 'all' ? 'All' : cat.label(r)}
              <span className="tnum ml-1.5 opacity-70">{counts[r] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads…"
            className="h-8 w-52 rounded-md border border-border bg-background pl-7 pr-2 text-sm"
          />
        </div>

        {/*
          Three slices, one control. ⚠ A SEGMENTED CONTROL RATHER THAN TWO
          TOGGLES: "needs working" and "show the spam" are answers to the same
          question (which leads am I looking at), and two independent booleans
          make four states of which one is meaningless.
        */}
        <div className="flex items-center rounded-md border border-border p-0.5">
          {([
            { key: 'working', label: 'Needs working', count: stats.count },
            { key: 'all', label: 'All', count: null },
            { key: 'filtered', label: 'Filtered', count: filtered },
          ] as const).map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              title={
                v.key === 'working'
                  ? 'Leads nobody has decided yet — the number on the sidebar badge.'
                  : v.key === 'all'
                    ? 'Every lead including the ones already ignored or expired. Kept so the triage can be audited.'
                    : 'Everything triage rejected as marketing or noise. Check it occasionally — this is how a wrongly-filtered bid gets caught.'
              }
              className={`inline-flex items-center gap-1.5 rounded px-2.5 text-sm min-h-[2.75rem] sm:min-h-0 sm:h-7 transition-colors ${
                view === v.key
                  ? 'bg-card text-foreground font-medium elev-1'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v.key === 'filtered' &&
                (view === 'filtered' ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />)}
              {v.label}
              {v.count !== null && <span className="tnum opacity-70">{v.count}</span>}
            </button>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={runSweep} disabled={sweeping}>
          <RefreshCw className={`size-4 ${sweeping ? 'animate-spin' : ''}`} />
          {sweeping ? 'Reading…' : 'Check now'}
        </Button>
      </div>

      {/* Queue */}
      {visible.length === 0 ? (
        <EmptyState
          title={
            view === 'filtered'
              ? 'Nothing filtered'
              : view === 'working'
                ? 'Nothing waiting on you'
                : 'No leads here'
          }
          description={
            view === 'filtered'
              ? 'Nothing has been rejected as marketing yet.'
              : leads.length === 0
                ? 'Nothing has arrived yet. Leads are read from info@ once a day — use Check now to read it immediately.'
                : // ⚠ AN EMPTY `working` VIEW OVER A FULL QUEUE IS A REAL AND GOOD
                  // OUTCOME, not a filter mistake, and it must not read like one —
                  // that is what the default view reaching zero MEANS. Says where
                  // the rest went rather than leaving the reader to wonder.
                  view === 'working'
                  ? 'Every inbound bid has been decided. The ones already ignored or expired are under All.'
                  : 'No leads match this filter.'
          }
        />
      ) : (
        <div className="space-y-2">
          {visible.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              cat={cat}
              onOpen={(l) => {
                void openLead(l)
              }}
              onDelete={deleteLead}
            />
          ))}
        </div>
      )}

      <LeadDetailSheet
        lead={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={replaceLead}
        siblings={siblings}
        onSelectSibling={(l) => void openLead(l)}
        notes={notes}
        attachOptions={attachOptions}
        categories={categories}
      />
    </div>
  )
}
