'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Map as MapIcon, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { UTAH_COUNTIES } from '@/lib/parcels/agrc'
import {
  PARCEL_STATUS_LABELS,
  parcelTotals,
  type ParcelRow,
} from '@/lib/parcels/queries'

interface LandTabProps {
  projectId: string
  parcels: ParcelRow[]
  canEdit: boolean
}

function acresLabel(value: number | null): string {
  if (value == null) return ''
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function LandTab({ projectId, parcels, canEdit }: LandTabProps) {
  const router = useRouter()
  const [importing, setImporting] = useState(false)
  const [showForm, setShowForm] = useState(parcels.length === 0)
  const [county, setCounty] = useState('Millard')
  const [schedule, setSchedule] = useState('')
  const [existingZone, setExistingZone] = useState('')
  const [requestedZone, setRequestedZone] = useState('')
  const [ownerName, setOwnerName] = useState('')

  const totals = useMemo(() => parcelTotals(parcels), [parcels])
  // Named apart from the schedule total and never summed with it — they are two
  // readings of the same ground, and one number that silently mixes them is the
  // failure CLAUDE.md §12 records as "one quantity, one definition".
  const countyAcres = useMemo(
    () =>
      parcels
        .filter((p) => p.status !== 'excluded' && p.assessor_acres != null)
        .reduce((sum, p) => sum + Number(p.assessor_acres), 0),
    [parcels]
  )

  async function handleImport() {
    if (!schedule.trim()) {
      toast.error('Paste a parcel schedule first.')
      return
    }
    setImporting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/parcels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ county, schedule, existingZone, requestedZone, ownerName }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast.error(body.error ?? 'Import failed')
        return
      }
      const r = body.result as {
        written: number
        withGeometry: number
        missingFromCounty: string[]
        lookupError: string | null
      }
      toast.success(
        `${r.written} parcels imported · ${r.withGeometry} with county boundaries`
      )
      if (r.lookupError) {
        toast.warning(`Boundaries unavailable: ${r.lookupError}`)
      } else if (r.missingFromCounty.length > 0) {
        toast.warning(
          `Not in ${county} County's records: ${r.missingFromCounty.join(', ')} — usually split or merged since the exhibit`
        )
      }
      setSchedule('')
      setShowForm(false)
      router.refresh()
    } catch {
      toast.error('Import failed')
    } finally {
      setImporting(false)
    }
  }

  async function handleDelete(parcel: ParcelRow) {
    const res = await fetch(
      `/api/projects/${projectId}/parcels?parcel=${parcel.id}`,
      { method: 'DELETE' }
    )
    if (!res.ok) {
      toast.error('Could not remove that parcel')
      return
    }
    toast.success(`${parcel.parcel_id} removed`)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {parcels.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Panel className="px-4 py-3">
            <div className="label-caps text-muted-foreground">Parcels</div>
            <div className="tnum mt-1 text-2xl font-semibold">{totals.count}</div>
          </Panel>
          <Panel className="px-4 py-3">
            <div className="label-caps text-muted-foreground">Schedule acres</div>
            <div className="tnum mt-1 text-2xl font-semibold">
              {acresLabel(totals.acres)}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              As the deal states it
            </div>
          </Panel>
          <Panel className="px-4 py-3">
            <div className="label-caps text-muted-foreground">County acres</div>
            <div className="tnum mt-1 text-2xl font-semibold">
              {countyAcres > 0 ? acresLabel(countyAcres) : 'Not on file'}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              As the assessor records it
            </div>
          </Panel>
        </div>
      )}

      {totals.disputed.length > 0 && (
        <Panel className="border-amber-300 px-4 py-3 dark:border-amber-800">
          <div className="label-caps text-amber-700 dark:text-amber-400">
            Acreage disagreement
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The schedule and the county assessor do not agree on{' '}
            {totals.disputed.length === 1 ? 'one parcel' : `${totals.disputed.length} parcels`}.
            Worth resolving against the recorder before the figure is relied on
            in an application or a purchase price.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {totals.disputed.map((p) => (
              <li key={p.id} className="tnum">
                <span className="font-medium">{p.parcel_id}</span> — schedule{' '}
                {acresLabel(p.acres)} ac vs county {acresLabel(p.assessor_acres)} ac
                <span className="text-muted-foreground">
                  {' '}
                  ({(Number(p.acres) - Number(p.assessor_acres)).toFixed(2)})
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <PanelHeader label="Parcel schedule" count={parcels.length || undefined}>
          <div className="flex items-center gap-2">
            {totals.withGeometry > 0 && (
              <Link
                href={`/map?project=${projectId}`}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <MapIcon size={13} />
                View on map
              </Link>
            )}
            {canEdit && (
              <button
                onClick={() => setShowForm((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Plus size={13} />
                Import schedule
              </button>
            )}
          </div>
        </PanelHeader>

        {parcels.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No parcels recorded for this project yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">Parcel</th>
                  <th className="px-3 py-2 text-right font-medium">Schedule ac</th>
                  <th className="px-3 py-2 text-right font-medium">County ac</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Zoning</th>
                  <th className="px-3 py-2 text-left font-medium">Boundary</th>
                  {canEdit && <th className="w-10 px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {parcels.map((p) => {
                  const disputed = totals.disputed.some((d) => d.id === p.id)
                  return (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2">
                          {p.color && (
                            <span
                              aria-hidden
                              className="size-2.5 shrink-0 rounded-sm ring-1 ring-inset ring-black/20"
                              style={{ backgroundColor: p.color }}
                            />
                          )}
                          <span className="font-medium">{p.parcel_id}</span>
                        </span>
                      </td>
                      <td className="tnum px-3 py-2 text-right">
                        {p.acres != null ? acresLabel(p.acres) : (
                          <span className="text-muted-foreground">Not stated</span>
                        )}
                      </td>
                      <td
                        className={
                          'tnum px-3 py-2 text-right ' +
                          (disputed ? 'text-amber-700 dark:text-amber-400' : '')
                        }
                      >
                        {p.assessor_acres != null ? acresLabel(p.assessor_acres) : (
                          <span className="text-muted-foreground">Not on file</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Chip>{PARCEL_STATUS_LABELS[p.status]}</Chip>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.existing_zone && p.requested_zone
                          ? `${p.existing_zone} → ${p.requested_zone}`
                          : p.existing_zone || p.requested_zone || 'Not recorded'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.geometry
                          ? `${p.geometry_source === 'utah_agrc' ? 'County GIS' : p.geometry_source ?? 'On file'}${p.geometry_asof ? ` · ${p.geometry_asof}` : ''}`
                          : 'None'}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => handleDelete(p)}
                            aria-label={`Remove parcel ${p.parcel_id}`}
                            title={`Remove parcel ${p.parcel_id}`}
                            className="relative inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            {/* 44px touch target without shifting the row (§12) */}
                            <span aria-hidden className="absolute -inset-2.5" />
                            <Trash2 size={13} />
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
      </Panel>

      {canEdit && showForm && (
        <Panel>
          <PanelHeader label="Import a parcel schedule" />
          <div className="space-y-4 p-4">
            <p className="text-sm text-muted-foreground">
              Paste the schedule from a county exhibit or title report — one
              parcel per line, id first, then acreage. Boundaries are then pulled
              from the county&rsquo;s own GIS by parcel number, so nothing is
              traced by hand.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="County">
                <Select
                  value={county}
                  onChange={(e) => setCounty(e.target.value)}
                >
                  {UTAH_COUNTIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Owner of record">
                <Input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Daves Farms Property Holdings, LLC"
                />
              </Field>
              <Field label="Existing zoning">
                <Input
                  value={existingZone}
                  onChange={(e) => setExistingZone(e.target.value)}
                  placeholder="Agriculture"
                />
              </Field>
              <Field label="Requested zoning">
                <Input
                  value={requestedZone}
                  onChange={(e) => setRequestedZone(e.target.value)}
                  placeholder="Heavy Industrial (HI)"
                />
              </Field>
            </div>
            <Field label="Schedule">
              <Textarea
                rows={8}
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder={'HD-5531-1\t44.58\tSubject\nHD-5530\t100.00\tSubject\nHD-5535\t160.00\tSubject'}
                className="font-mono"
              />
            </Field>
            <div className="flex items-center gap-2">
              <button
                onClick={handleImport}
                disabled={importing}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {importing && <Loader2 size={14} className="animate-spin" />}
                {importing ? 'Importing…' : 'Import parcels'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Cancel
              </button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  )
}
