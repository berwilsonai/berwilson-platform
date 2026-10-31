'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import { scopeBody, type RecordKind } from '@/lib/records/scope'
import {
  MAX_POWER_PHASES,
  cumulativeRamp,
  formatMegawatts,
  powerTotal,
  sortPhases,
  type PowerPhase,
} from '@/lib/records/power'

/**
 * The ramp-up schedule editor — up to six tranches of megawatt capacity, each
 * with the date it comes online.
 *
 * Richard, 2026-10-30: *"allow it to add up to 6 phases of Megawatt power with
 * a date. For example, 100 MW by June 1 2027, 300 MW by August 2029. Total 400
 * MW."*
 *
 * ⚠ IT SHOWS THE RUNNING TOTAL BESIDE EVERY ROW, AND THAT IS THE POINT OF THE
 * LAYOUT, not decoration. A phase figure can be read as an INCREMENT or as a
 * RUNNING TOTAL and the two are indistinguishable once typed — type 300 into
 * phase 2 under a cumulative reading and you mean "300 total", under an
 * increment reading you mean "300 more". The platform stores increments
 * (Richard's own example settles it: 100 + 300 = 400, not 300). The only honest
 * way to hold somebody to that is to show them, as they type, what the platform
 * made of it: the row says `+300 MW` and the column beside it says `400 MW
 * online`. Nobody can enter the wrong reading without seeing it.
 *
 * ⚠ IT IS SHOWN WHETHER OR NOT THERE IS A SCHEDULE. §12: a surface hidden
 * because it is empty is hidden exactly when somebody needs to fill it —
 * count-gating is right for READING a populated record and wrong for the first
 * WRITE. This is the only door to the platform's stated key metric, so an empty
 * state with an Add button is the whole job on sixteen of the deals.
 *
 * ⚠ ONE DOOR, AND IT IS THE SHARED CHILD REGISTRY. Writes go to
 * /api/records/power-phases, which is the same spec-driven pair every other
 * shared child uses — so the record-level access check (a confidential project
 * refuses), the acting-user stamp on the audit log, the field whitelist and the
 * CHECK-constraint messages all come for free and cannot be forgotten here.
 * §12 records six of seven hand-written child routes having missed that check.
 */

/** A row as it exists on the server. `id` is what a PATCH/DELETE addresses. */
export interface PowerPhaseRow extends PowerPhase {
  id: string
}

/** What the inputs hold while somebody is typing: strings, always. */
interface Draft {
  megawatts: string
  target_date: string
  label: string
}

function toDraft(row: PowerPhaseRow): Draft {
  return {
    megawatts: row.megawatts == null ? '' : String(row.megawatts),
    target_date: row.target_date ?? '',
    label: row.label ?? '',
  }
}

export default function PowerRamp({
  kind,
  recordId,
  phases,
  canEdit = true,
}: {
  kind: RecordKind
  recordId: string
  phases: PowerPhaseRow[]
  canEdit?: boolean
}) {
  const router = useRouter()
  const rows = useMemo(() => sortPhases(phases), [phases])
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, toDraft(row)]))
  )
  const [busy, setBusy] = useState<string | null>(null)

  /*
    ⚠ THE TOTAL IS COMPUTED FROM THE DRAFTS, NOT FROM `phases`. A figure that
    only updates after a round-trip tells you what the server thought a moment
    ago, which on the one surface whose job is to make the increment/cumulative
    reading visible is precisely the wrong moment to be stale. `powerTotal`
    parses strings already — that is why it takes `number | string | null`.
  */
  const live = rows.map((row) => ({
    ...row,
    megawatts: drafts[row.id]?.megawatts ?? row.megawatts,
    target_date: drafts[row.id]?.target_date || null,
  }))
  const total = powerTotal(live)
  const steps = cumulativeRamp(live)
  const cumulativeByPhase = new Map(steps.map((s) => [s.phase.phase_no, s.cumulative]))

  // The lowest free slot. Deleting phase 2 of three leaves a gap, and the next
  // Add fills it rather than renumbering the others — a renumber is N writes
  // that can half-fail, and the number is an identity here, not a position.
  const nextFreeNo = useMemo(() => {
    const taken = new Set(rows.map((row) => row.phase_no))
    for (let n = 1; n <= MAX_POWER_PHASES; n += 1) if (!taken.has(n)) return n
    return null
  }, [rows])

  async function save(row: PowerPhaseRow, patch: Partial<Draft>) {
    const before = drafts[row.id] ?? toDraft(row)
    const next = { ...before, ...patch }
    setDrafts((d) => ({ ...d, [row.id]: next }))

    // Nothing actually changed — do not spend a write, and do not flash a
    // toast at somebody who only tabbed through the field.
    const unchanged =
      next.megawatts === before.megawatts &&
      next.target_date === before.target_date &&
      next.label === before.label
    if (unchanged && patch !== undefined && Object.keys(patch).length > 0) {
      const current = toDraft(row)
      if (
        next.megawatts === current.megawatts &&
        next.target_date === current.target_date &&
        next.label === current.label
      ) {
        return
      }
    }

    setBusy(row.id)
    try {
      const response = await fetch(`/api/records/power-phases/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          megawatts: next.megawatts,
          target_date: next.target_date,
          label: next.label,
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        // Put the row back to what the server still holds, or the screen shows
        // a figure the database refused and the total silently includes it.
        setDrafts((d) => ({ ...d, [row.id]: toDraft(row) }))
        toast.error(body?.error ?? 'Could not save that phase')
        return
      }
      router.refresh()
    } catch {
      setDrafts((d) => ({ ...d, [row.id]: toDraft(row) }))
      toast.error('Could not save that phase')
    } finally {
      setBusy(null)
    }
  }

  async function addPhase() {
    if (nextFreeNo == null) return
    setBusy('new')
    try {
      const response = await fetch('/api/records/power-phases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...scopeBody(kind, recordId),
          phase_no: nextFreeNo,
          // ⚠ A PLACEHOLDER MEGAWATT FIGURE, BECAUSE THE SCHEMA REFUSES ZERO
          // AND REQUIRES THE COLUMN. There is no honest "empty" value for a
          // NOT NULL positive numeric, and §12 is explicit that guessing a
          // value for such a column is how a form starts collecting invented
          // data. 1 is the smallest thing that is unmistakably a placeholder
          // rather than a measurement, the field is focused and selected on
          // arrival, and the row is one click from deletion.
          megawatts: 1,
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? 'Could not add a phase')
        return
      }
      router.refresh()
    } catch {
      toast.error('Could not add a phase')
    } finally {
      setBusy(null)
    }
  }

  async function removePhase(row: PowerPhaseRow) {
    setBusy(row.id)
    try {
      const response = await fetch(`/api/records/power-phases/${row.id}`, { method: 'DELETE' })
      if (!response.ok) {
        toast.error('Could not remove that phase')
        return
      }
      router.refresh()
    } catch {
      toast.error('Could not remove that phase')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel className="p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="label-caps text-muted-foreground">Ramp-up schedule</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-prose">
            Each phase is the capacity that tranche <strong className="font-medium text-foreground">adds</strong>.
            The total is their sum.
          </p>
        </div>
        {/*
          The key metric, at the top of the thing that produces it.

          ⚠ NO FIGURE AT ALL UNTIL THERE IS ONE. The first version printed an
          em dash here at `text-metric` weight, and the screenshot settled it:
          a dash that size reads as a strikethrough or a failed render, not as
          "nobody has entered this yet" — which is the §12 rule this very file
          quotes two screens up and then broke. The empty state below already
          says what to do in words, so the slot is simply absent.
        */}
        {total.megawatts != null && (
          <div className="text-right shrink-0">
            <div className="flex items-baseline gap-1.5 justify-end">
              <Zap size={14} className="text-primary shrink-0" aria-hidden />
              <span className="text-metric tnum text-foreground">
                {formatMegawatts(total.megawatts)}
              </span>
            </div>
            <p className="label-caps text-muted-foreground mt-0.5">Total capacity</p>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No phases yet. Add the first tranche of capacity and the date it comes online.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4 sm:-mx-5 sm:px-5">
          <table className="w-full text-sm min-w-[34rem]">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="w-16 px-2 py-1.5 text-left label-caps text-muted-foreground">Phase</th>
                <th scope="col" className="w-32 px-2 py-1.5 text-left label-caps text-muted-foreground">Capacity</th>
                <th scope="col" className="w-44 px-2 py-1.5 text-left label-caps text-muted-foreground">Online by</th>
                <th scope="col" className="px-2 py-1.5 text-left label-caps text-muted-foreground">Label</th>
                <th scope="col" className="w-28 px-2 py-1.5 text-right label-caps text-muted-foreground">Cumulative</th>
                {canEdit && <th scope="col" className="w-10 px-2 py-1.5"><span className="sr-only">Remove</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const draft = drafts[row.id] ?? toDraft(row)
                const cumulative = cumulativeByPhase.get(row.phase_no)
                return (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-2 text-muted-foreground tnum">{row.phase_no}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Phase ${row.phase_no} capacity in megawatts`}
                          disabled={!canEdit}
                          value={draft.megawatts}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [row.id]: { ...draft, megawatts: e.target.value } }))
                          }
                          onBlur={() => save(row, { megawatts: draft.megawatts })}
                          className={cn(
                            'w-20 h-9 rounded-md border border-input bg-background px-2 text-sm tnum',
                            'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                            'disabled:opacity-60'
                          )}
                        />
                        <span className="text-xs text-muted-foreground">MW</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <DatePicker
                        value={draft.target_date}
                        onChange={(value) => save(row, { target_date: value })}
                        placeholder="No date yet"
                        className="w-40"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        aria-label={`Phase ${row.phase_no} label`}
                        disabled={!canEdit}
                        value={draft.label}
                        placeholder="Optional"
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [row.id]: { ...draft, label: e.target.value } }))
                        }
                        onBlur={() => save(row, { label: draft.label })}
                        className={cn(
                          'w-full h-9 rounded-md border border-input bg-background px-2 text-sm',
                          'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                          'disabled:opacity-60'
                        )}
                      />
                    </td>
                    {/* The running total — what is online once this lands. */}
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <span className="tnum text-muted-foreground" title="Total online once this phase lands">
                        {cumulative != null ? formatMegawatts(cumulative) : '—'}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removePhase(row)}
                          disabled={busy === row.id}
                          aria-label={`Remove phase ${row.phase_no}`}
                          className={cn(
                            'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground',
                            'hover:bg-critical-surface hover:text-critical transition-colors',
                            'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                            'disabled:opacity-50'
                          )}
                        >
                          {busy === row.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={addPhase}
            disabled={nextFreeNo == null || busy === 'new'}
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-input bg-background',
              'text-sm font-medium hover:bg-accent transition-colors',
              'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              'disabled:opacity-50 disabled:pointer-events-none'
            )}
          >
            {busy === 'new' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Add phase
          </button>
          {nextFreeNo == null && (
            <span className="text-xs text-muted-foreground">
              A schedule holds at most {MAX_POWER_PHASES} phases.
            </span>
          )}
        </div>
      )}
    </Panel>
  )
}
