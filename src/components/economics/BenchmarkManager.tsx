'use client'

/**
 * The benchmark library, maintained by hand.
 *
 * ⚠ `needs_review` IS THE LOUDEST THING ON THE ROW. Every seeded entry carries
 * it, because picking a benchmark stamps an input's provenance as "Benchmark"
 * with that row's source, which is a claim somebody checked a market. The
 * seeds are plausible public ranges and say so; the flag is what stops them
 * being read as researched figures.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Panel } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Field, FormGrid, FormSection, Input, Select, Textarea } from '@/components/ui/field'
import { formatDate } from '@/lib/utils/constants'
import { BENCHMARK_TONES, type Benchmark } from '@/lib/economics/benchmarks'

const TONE_CLASS: Record<string, string> = {
  slate: 'bg-muted text-muted-foreground',
  sky: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}

type Draft = Record<string, string>

const BLANK: Draft = {
  key: '',
  label: '',
  value_low: '',
  value_high: '',
  unit: '',
  geography: '',
  source: '',
  as_of: '',
  notes: '',
  tone: 'slate',
}

function range(b: Benchmark): string {
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 })
  if (b.valueLow != null && b.valueHigh != null && b.valueLow !== b.valueHigh) {
    return `${fmt(b.valueLow)} to ${fmt(b.valueHigh)}`
  }
  const one = b.valueLow ?? b.valueHigh
  return one == null ? 'no figure' : fmt(one)
}

export default function BenchmarkManager({ benchmarks }: { benchmarks: Benchmark[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [busy, setBusy] = useState<string | null>(null)

  const needingReview = benchmarks.filter((b) => b.needsReview).length

  async function call(key: string, path: string, method: string, body?: unknown, ok?: string) {
    setBusy(key)
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(payload.error ?? 'That did not save')
        return false
      }
      if (ok) toast.success(ok)
      router.refresh()
      return true
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {needingReview > 0 ? (
        <Panel className="p-4">
          <p className="text-sm">
            <span className="font-medium">
              {needingReview} of {benchmarks.length} benchmarks are marked for review.
            </span>{' '}
            <span className="text-muted-foreground">
              These were seeded as plausible public ranges so the mechanism works on day one.
              Nobody checked them against a data service. Replace the figure and the source, then
              clear the flag, and an input citing one becomes a real benchmark rather than a tidy
              guess.
            </span>
          </p>
        </Panel>
      ) : null}

      <Panel className="p-4 sm:p-5">
        <h2 className="label-caps text-muted-foreground">The library</h2>
        {benchmarks.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Empty. An input can still be priced; it just reads as a planning assumption.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {benchmarks.map((b) => (
              <li key={b.id} className="group rounded-md bg-muted/30 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{b.label}</span>
                      <Chip className={TONE_CLASS[b.tone] ?? TONE_CLASS.slate}>{b.unit}</Chip>
                      {b.needsReview ? (
                        <Chip className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                          Needs review
                        </Chip>
                      ) : null}
                      {!b.active ? (
                        <Chip className="bg-muted text-muted-foreground">Retired</Chip>
                      ) : null}
                    </div>
                    <p className="tnum mt-1 text-sm">
                      {range(b)}{' '}
                      <span className="text-xs font-normal text-muted-foreground">{b.unit}</span>
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      <span className="font-mono">{b.key}</span>
                      {b.geography ? ` · ${b.geography}` : ''}
                      {b.asOf ? ` · as of ${formatDate(b.asOf)}` : ' · undated'}
                    </p>
                    {b.source ? (
                      <p className="mt-1 max-w-prose text-[11px] text-muted-foreground">
                        {b.source}
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                        No source. A benchmark with no source is a rumour.
                      </p>
                    )}
                    {b.notes ? (
                      <p className="mt-1 max-w-prose text-[11px] text-muted-foreground">
                        {b.notes}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === b.id}
                      onClick={() =>
                        void call(
                          b.id,
                          `/api/settings/economics-benchmarks/${b.id}`,
                          'PATCH',
                          b.needsReview ? { needs_review: false } : { needs_review: true },
                          b.needsReview ? 'Marked as checked' : 'Flagged for review'
                        )
                      }
                    >
                      {b.needsReview ? 'Mark checked' : 'Flag'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === b.id}
                      onClick={() =>
                        void call(
                          b.id,
                          `/api/settings/economics-benchmarks/${b.id}`,
                          'PATCH',
                          { active: !b.active },
                          b.active ? 'Retired' : 'Back in use'
                        )
                      }
                    >
                      {b.active ? 'Retire' : 'Restore'}
                    </Button>
                    <button
                      type="button"
                      aria-label={`Delete ${b.label}`}
                      className="relative rounded p-1 text-muted-foreground opacity-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      onClick={() =>
                        void call(
                          b.id,
                          `/api/settings/economics-benchmarks/${b.id}`,
                          'DELETE',
                          undefined,
                          'Deleted'
                        )
                      }
                    >
                      <span className="absolute -inset-3" />
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Retiring keeps every citation intact. Deleting is refused while an input still cites the
          benchmark as its source.
        </p>
      </Panel>

      <Panel className="p-4 sm:p-5">
        <FormSection
          title="Add a benchmark"
          description="A range where the market has one. A unit is required: without it a figure cannot be filled into an input safely."
          collapsible
          defaultOpen={benchmarks.length === 0}
        >
          <FormGrid cols={2}>
            <Field
              id="bm-key"
              label="Key"
              hint="lowercase, hyphens. This is what an input's provenance points at"
            >
              <Input
                id="bm-key"
                value={draft.key}
                placeholder="dc-lease-primary"
                onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
              />
            </Field>
            <Field id="bm-label" label="Name">
              <Input
                id="bm-label"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              />
            </Field>
            <Field id="bm-low" label="Low">
              <Input
                id="bm-low"
                inputMode="decimal"
                value={draft.value_low}
                onChange={(e) => setDraft((d) => ({ ...d, value_low: e.target.value }))}
              />
            </Field>
            <Field id="bm-high" label="High" hint="leave empty for a point estimate">
              <Input
                id="bm-high"
                inputMode="decimal"
                value={draft.value_high}
                onChange={(e) => setDraft((d) => ({ ...d, value_high: e.target.value }))}
              />
            </Field>
            <Field id="bm-unit" label="Unit" hint="$/kW-month, $/MW, $/kWh, %, Btu/kWh">
              <Input
                id="bm-unit"
                value={draft.unit}
                onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
              />
            </Field>
            <Field id="bm-geo" label="Geography">
              <Input
                id="bm-geo"
                value={draft.geography}
                onChange={(e) => setDraft((d) => ({ ...d, geography: e.target.value }))}
              />
            </Field>
            <Field id="bm-asof" label="As of" hint="YYYY-MM-DD. Over a year old warns">
              <Input
                id="bm-asof"
                placeholder="2026-10-05"
                value={draft.as_of}
                onChange={(e) => setDraft((d) => ({ ...d, as_of: e.target.value }))}
              />
            </Field>
            <Field id="bm-tone" label="Tone" hint="a colour name, not a class">
              <Select
                id="bm-tone"
                value={draft.tone}
                onChange={(e) => setDraft((d) => ({ ...d, tone: e.target.value }))}
              >
                {BENCHMARK_TONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="bm-source"
              label="Source"
              hint="who said so. Without it the row is flagged for review"
              className="sm:col-span-2"
            >
              <Input
                id="bm-source"
                value={draft.source}
                onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
              />
            </Field>
            <Field id="bm-notes" label="Notes" className="sm:col-span-2">
              <Textarea
                id="bm-notes"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </Field>
          </FormGrid>
          <div className="mt-3">
            <Button
              size="sm"
              disabled={busy === 'new' || !draft.key.trim() || !draft.label.trim() || !draft.unit.trim()}
              onClick={async () => {
                const ok = await call(
                  'new',
                  '/api/settings/economics-benchmarks',
                  'POST',
                  draft,
                  'Added'
                )
                if (ok) setDraft(BLANK)
              }}
            >
              {busy === 'new' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add it
            </Button>
          </div>
        </FormSection>
      </Panel>
    </div>
  )
}
