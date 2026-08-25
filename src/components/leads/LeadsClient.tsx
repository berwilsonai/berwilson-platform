'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, RefreshCw, EyeOff, Eye } from 'lucide-react'
import { Panel } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/shared/EmptyState'
import LeadCard from './LeadCard'
import LeadDetailSheet from './LeadDetailSheet'
import { ROUTE_TABS, ROUTE_LABELS } from '@/lib/utils/leads'
import { formatValue } from '@/lib/utils/constants'
import type { LeadRoute } from '@/lib/ai/prompts/lead-triage'
import type { LeadRow } from '@/lib/leads/db'

type RouteFilter = LeadRoute | 'all'

/**
 * The inbound lead queue.
 *
 * Everything filters in memory — the server ships the open queue plus filtered
 * rows in one go, and the volume (a quarter of one inbox) is small enough that
 * a round trip per tab would be pure latency.
 */
export default function LeadsClient({
  initialLeads,
  filteredCount,
}: {
  initialLeads: LeadRow[]
  filteredCount: number
}) {
  const router = useRouter()
  const [leads, setLeads] = useState(initialLeads)
  const [route, setRoute] = useState<RouteFilter>('all')
  const [query, setQuery] = useState('')
  const [showFiltered, setShowFiltered] = useState(false)
  const [selected, setSelected] = useState<LeadRow | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sweeping, setSweeping] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return leads.filter((l) => {
      if (showFiltered ? l.status !== 'spam' : l.status === 'spam') return false
      if (route !== 'all' && l.route !== route) return false
      if (!q) return true
      return [l.title, l.sender_company, l.sender_name, l.summary, l.location]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    })
  }, [leads, route, query, showFiltered])

  const counts = useMemo(() => {
    const open = leads.filter((l) => l.status !== 'spam')
    const map: Record<string, number> = { all: open.length }
    for (const r of ROUTE_TABS) map[r] = open.filter((l) => l.route === r).length
    return map
  }, [leads])

  // Captured once at mount rather than read during render — "now" moving under
  // a memo is exactly the impurity the React Compiler rejects.
  const [mountedAt] = useState(() => Date.now())

  const stats = useMemo(() => {
    const open = leads.filter((l) => l.status !== 'spam')
    const value = open.reduce((sum, l) => sum + (l.estimated_value ?? 0), 0)
    const pursue = open.filter((l) => l.fit_recommendation === 'pursue').length
    const closingSoon = open.filter((l) => {
      if (!l.bid_due_date) return false
      const days = (new Date(l.bid_due_date).getTime() - mountedAt) / 86_400_000
      return days >= 0 && days <= 7
    }).length
    return { count: open.length, value, pursue, closingSoon }
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
          { label: 'Open leads', value: String(stats.count) },
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
          {(['all', ...ROUTE_TABS] as RouteFilter[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoute(r)}
              className={`h-8 rounded-md px-2.5 text-sm ${
                route === r ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              }`}
            >
              {r === 'all' ? 'All' : ROUTE_LABELS[r]}
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

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFiltered((v) => !v)}
          title="Everything triage rejected as marketing or noise. Check it occasionally — this is how a wrongly-filtered bid gets caught."
        >
          {showFiltered ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          {showFiltered ? 'Showing filtered' : `Filtered (${filteredCount})`}
        </Button>

        <Button variant="outline" size="sm" onClick={runSweep} disabled={sweeping}>
          <RefreshCw className={`size-4 ${sweeping ? 'animate-spin' : ''}`} />
          {sweeping ? 'Reading…' : 'Check now'}
        </Button>
      </div>

      {/* Queue */}
      {visible.length === 0 ? (
        <EmptyState
          title={showFiltered ? 'Nothing filtered' : 'No leads here'}
          description={
            showFiltered
              ? 'Nothing has been rejected as marketing yet.'
              : leads.length === 0
                ? 'Nothing has arrived yet. Leads are read from info@ once a day — use Check now to read it immediately.'
                : 'No leads match this filter.'
          }
        />
      ) : (
        <div className="space-y-2">
          {visible.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onOpen={(l) => {
                setSelected(l)
                setSheetOpen(true)
              }}
            />
          ))}
        </div>
      )}

      <LeadDetailSheet
        lead={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={replaceLead}
      />
    </div>
  )
}
