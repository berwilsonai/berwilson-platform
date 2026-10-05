'use client'

/**
 * Editing a deal's economics.
 *
 * The read panels above this are server-rendered from the same engine call, so
 * every save ends in `router.refresh()` rather than this component keeping its
 * own idea of the answer. One engine, one number on the screen.
 *
 * ⚠ CLEARING A FIELD SENDS NULL, NEVER 0. Every numeric input is held as a
 * string and an empty string becomes null on the way out, because the whole
 * engine treats null as "nobody has said" and 0 as a real price. An input that
 * defaulted a cleared rate to 0 would silently price a deal at nothing.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Panel } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, FormGrid, FormSection, Input, Select, Textarea } from '@/components/ui/field'
import {
  CAPACITY_SOURCE_KINDS,
  CAPACITY_SOURCE_LABELS,
  MONEY_SHAPE_LABELS,
  PROVENANCE_LABELS,
  PROVENANCE_ORDER,
  REVENUE_LINE_LABELS,
  REVENUE_LINE_TYPES,
  SPV_PURPOSES,
  SPV_PURPOSE_LABELS,
  type DealEconomicsInput,
  type DealEconomicsResult,
  type RevenueLineType,
} from '@/lib/economics'
import {
  benchmarkUnitFor,
  LINE_COMMON_FIELDS,
  LINE_FORM_FIELDS,
  type LineFieldDef,
} from '@/lib/economics/line-fields'
import { benchmarkFigure, type Benchmark } from '@/lib/economics/benchmarks'

interface EconomicsEditorProps {
  economicsId: string
  recordName: string
  input: DealEconomicsInput
  result: DealEconomicsResult
  notes: string | null
  statedShape: string | null
  /** The active library, for filling a field from a market figure. */
  benchmarks: Benchmark[]
}

type Draft = Record<string, string | boolean>

/** An empty string means "nobody has said". It must never arrive as 0. */
function outbound(draft: Draft): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(draft)) {
    if (typeof value === 'boolean') body[key] = value
    else body[key] = value.trim() === '' ? null : value
  }
  return body
}

export default function EconomicsEditor({
  economicsId,
  recordName,
  input,
  result,
  notes,
  statedShape,
  benchmarks,
}: EconomicsEditorProps) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  const [deal, setDeal] = useState<Draft>({
    discount_rate_pct: input.discountRatePct?.toString() ?? '',
    cap_rate_pct: input.capRatePct?.toString() ?? '',
    base_year: input.baseYear?.toString() ?? '',
    stated_total_amount: input.statedTotal?.amount.toString() ?? '',
    stated_total_shape: statedShape ?? '',
    notes: notes ?? '',
  })

  const [lineType, setLineType] = useState<RevenueLineType>('energy_sale')
  const [lineDraft, setLineDraft] = useState<Draft>({})
  // field name -> benchmark key. Sent as `_sources` so the server can resolve
  // each key and write the provenance row itself: a client must not be able to
  // assert a source and a date the library does not hold.
  const [lineSources, setLineSources] = useState<Record<string, string>>({})
  const [spvDraft, setSpvDraft] = useState<Draft>({ label: '', purpose: 'other', bw_ownership_pct: '' })
  const [sourceDraft, setSourceDraft] = useState<Draft>({
    label: '',
    kind: 'grid_interconnect',
    nameplate_mw: '',
    availability_pct: '',
    block_count: '',
    redundant_blocks: '',
    block_mw: '',
    stated_net_mw: '',
  })

  async function call(
    key: string,
    path: string,
    method: string,
    body?: unknown,
    successMessage?: string
  ): Promise<boolean> {
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
      if (successMessage) toast.success(successMessage)
      router.refresh()
      return true
    } catch {
      toast.error('That did not save')
      return false
    } finally {
      setBusy(null)
    }
  }

  const base = `/api/economics/${economicsId}`

  async function recompute() {
    setBusy('compute')
    try {
      const res = await fetch(`${base}/compute`, { method: 'POST' })
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        published?: boolean
      }
      if (!res.ok) {
        toast.error(payload.error ?? 'Could not recompute')
        return
      }
      // Two different outcomes, said apart. Reporting a plain success for a
      // model nothing will read is how a blocked figure gets quoted anyway.
      if (payload.published) toast.success('Recomputed, and the pipeline value updated')
      else
        toast.warning(
          'Recomputed, but nothing was published: resolve what is blocking before this deal has a size'
        )
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  function renderLineField(field: LineFieldDef) {
    const value = lineDraft[field.name]
    const id = `line-${field.name}`

    if (field.kind === 'bool') {
      return (
        <label
          key={field.name}
          className="relative flex min-h-11 items-start gap-2 text-sm sm:col-span-2"
        >
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => setLineDraft((d) => ({ ...d, [field.name]: e.target.checked }))}
            className="mt-0.5 size-4 rounded border-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <span>
            <span className="block">{field.label}</span>
            {field.hint ? (
              <span className="block text-[11px] text-muted-foreground">{field.hint}</span>
            ) : null}
          </span>
        </label>
      )
    }

    const options =
      field.kind === 'line_ref'
        ? input.lines
            .filter((l) => l.id !== lineDraft.id)
            .map((l) => ({ value: l.id, label: l.label }))
        : field.kind === 'bucket_ref'
          ? input.buckets.map((b) => ({ value: b.id, label: b.label }))
          : (field.options ?? [])

    if (field.kind === 'select' || field.kind === 'line_ref' || field.kind === 'bucket_ref') {
      return (
        <Field
          key={field.name}
          id={id}
          label={field.label}
          hint={field.hint}
          className={field.wide ? 'sm:col-span-2' : undefined}
        >
          <Select
            id={id}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setLineDraft((d) => ({ ...d, [field.name]: e.target.value }))}
          >
            <option value="">Not set</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )
    }

    const unit = benchmarkUnitFor(
      field.name,
      typeof lineDraft.price_unit === 'string' ? lineDraft.price_unit : undefined
    )
    // ⚠ Offered ONLY where the benchmark's unit matches the field's. A
    // $/kW-month rate filling a $/kWh price is a 1,000-fold error that reads
    // as a plausible number.
    const matching = unit ? benchmarks.filter((b) => b.unit === unit) : []
    const cited = lineSources[field.name]

    return (
      <Field
        key={field.name}
        id={id}
        label={field.label}
        hint={field.hint}
        className={field.wide ? 'sm:col-span-2' : undefined}
      >
        <Input
          id={id}
          inputMode={field.kind === 'text' ? undefined : 'decimal'}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => {
            // Typing over a filled figure drops the citation: the number is no
            // longer the benchmark's, so claiming its source would be a lie.
            setLineSources((m) => {
              if (!(field.name in m)) return m
              const next = { ...m }
              delete next[field.name]
              return next
            })
            setLineDraft((d) => ({ ...d, [field.name]: e.target.value }))
          }}
        />
        {matching.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {matching.map((b) => {
              const figure = benchmarkFigure(b)
              if (figure.value == null) return null
              return (
                <button
                  key={b.id}
                  type="button"
                  className="relative rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  title={`${figure.display}${b.source ? ` — ${b.source}` : ''}${
                    b.needsReview ? ' (still marked for review)' : ''
                  }`}
                  onClick={() => {
                    setLineDraft((d) => ({ ...d, [field.name]: String(figure.value) }))
                    setLineSources((m) => ({ ...m, [field.name]: b.key }))
                  }}
                >
                  {b.label}
                  {figure.isMidpointOfBand ? ' (mid)' : ''}
                </button>
              )
            })}
          </div>
        ) : null}
        {cited ? (
          <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">
            Will be recorded as sourced from {cited}
          </p>
        ) : null}
      </Field>
    )
  }

  return (
    <div className="space-y-4">
      <Panel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="label-caps text-muted-foreground">Publish</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {result.valid
                ? 'Recompute to update this deal’s pipeline value, which is Ber Wilson net capture.'
                : 'Nothing is published while the model is blocked. The figures above still update as you edit.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={recompute} disabled={busy === 'compute'}>
              {busy === 'compute' ? <Loader2 className="size-4 animate-spin" /> : null}
              Recompute and publish
            </Button>
            <Button
              variant="outline"
              disabled={busy === 'version'}
              onClick={() => {
                const label = window.prompt('Name this version, so the history reads as decisions')
                if (label === null) return
                void call(
                  'version',
                  `${base}/versions`,
                  'POST',
                  { label },
                  'Version saved'
                )
              }}
            >
              Save a version
            </Button>
          </div>
        </div>
      </Panel>

      <Panel className="p-4 sm:p-5">
        <FormSection
          title="Deal-level inputs"
          description="No defaults. An empty rate means nobody has said, and the figures that need it read as unavailable rather than guessed."
          collapsible
          defaultOpen={input.discountRatePct == null}
        >
          <FormGrid cols={2}>
            <Field id="discount" label="Discount rate, %" hint="needed for any NPV">
              <Input
                id="discount"
                inputMode="decimal"
                value={deal.discount_rate_pct as string}
                onChange={(e) => setDeal((d) => ({ ...d, discount_rate_pct: e.target.value }))}
              />
            </Field>
            <Field id="cap" label="Cap rate, %" hint="needed for a stabilized asset value">
              <Input
                id="cap"
                inputMode="decimal"
                value={deal.cap_rate_pct as string}
                onChange={(e) => setDeal((d) => ({ ...d, cap_rate_pct: e.target.value }))}
              />
            </Field>
            <Field id="baseyear" label="Base year" hint="year 1 when a line does not state its own">
              <Input
                id="baseyear"
                inputMode="numeric"
                value={deal.base_year as string}
                onChange={(e) => setDeal((d) => ({ ...d, base_year: e.target.value }))}
              />
            </Field>
            <Field
              id="statedamount"
              label="Stated deal total"
              hint="what a document or a conversation says it is worth"
            >
              <Input
                id="statedamount"
                inputMode="decimal"
                value={deal.stated_total_amount as string}
                onChange={(e) => setDeal((d) => ({ ...d, stated_total_amount: e.target.value }))}
              />
            </Field>
            <Field
              id="statedshape"
              label="And which figure that is"
              hint="an annual total compared against a contract total reports the whole deal as unattributed"
              className="sm:col-span-2"
            >
              <Select
                id="statedshape"
                value={deal.stated_total_shape as string}
                onChange={(e) => setDeal((d) => ({ ...d, stated_total_shape: e.target.value }))}
              >
                <option value="">Not set</option>
                {Object.entries(MONEY_SHAPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="dealnotes" label="Notes" className="sm:col-span-2">
              <Textarea
                id="dealnotes"
                value={deal.notes as string}
                onChange={(e) => setDeal((d) => ({ ...d, notes: e.target.value }))}
              />
            </Field>
          </FormGrid>
          <div className="mt-3">
            <Button
              size="sm"
              disabled={busy === 'deal'}
              onClick={() => void call('deal', base, 'PATCH', outbound(deal), 'Saved')}
            >
              {busy === 'deal' ? <Loader2 className="size-4 animate-spin" /> : null}
              Save inputs
            </Button>
          </div>
        </FormSection>
      </Panel>

      <Panel className="p-4 sm:p-5">
        <FormSection
          title="Vehicles"
          description="Which SPV earns each line. An ownership split left empty means not yet determined, and revenue there is held out of the net figure rather than counted as all ours."
          collapsible
          defaultOpen={input.spvs.length === 0}
        >
          {input.spvs.length > 0 ? (
            <ul className="mb-4 space-y-1.5 text-sm">
              {input.spvs.map((spv) => (
                <li key={spv.id} className="group flex items-center justify-between gap-2">
                  <span>
                    {spv.label}
                    <span className="text-muted-foreground">
                      {' · '}
                      {SPV_PURPOSE_LABELS[spv.purpose]}
                      {' · '}
                      {spv.bwOwnershipPct == null
                        ? 'split not set'
                        : `${spv.bwOwnershipPct}% ours`}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${spv.label}`}
                    className="relative rounded p-1 text-muted-foreground opacity-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    onClick={() =>
                      void call('spv-del', `${base}/spvs/${spv.id}`, 'DELETE', undefined, 'Removed')
                    }
                  >
                    <span className="absolute -inset-3" />
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mb-4 rounded-md bg-muted/40 p-3 text-sm">
              <p>
                This deal has no vehicles yet, so every line is earned by Ber Wilson Corporation
                and is wholly ours.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={busy === 'spv-standard'}
                onClick={() =>
                  void call(
                    'spv-standard',
                    `${base}/spvs-standard`,
                    'POST',
                    { prefix: recordName },
                    'Land, Energy and Data Center added'
                  )
                }
              >
                Set up Land, Energy and Data Center
              </Button>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Model vehicles only. No legal entity is created and no ownership split is assumed.
              </p>
            </div>
          )}

          <FormGrid cols={3}>
            <Field id="spvlabel" label="Name">
              <Input
                id="spvlabel"
                value={spvDraft.label as string}
                onChange={(e) => setSpvDraft((d) => ({ ...d, label: e.target.value }))}
              />
            </Field>
            <Field id="spvpurpose" label="Purpose">
              <Select
                id="spvpurpose"
                value={spvDraft.purpose as string}
                onChange={(e) => setSpvDraft((d) => ({ ...d, purpose: e.target.value }))}
              >
                {SPV_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {SPV_PURPOSE_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="spvpct" label="Ber Wilson share, %" hint="leave empty if undecided">
              <Input
                id="spvpct"
                inputMode="decimal"
                value={spvDraft.bw_ownership_pct as string}
                onChange={(e) => setSpvDraft((d) => ({ ...d, bw_ownership_pct: e.target.value }))}
              />
            </Field>
          </FormGrid>
          <div className="mt-3">
            <Button
              size="sm"
              variant="outline"
              disabled={busy === 'spv' || !(spvDraft.label as string).trim()}
              onClick={async () => {
                const ok = await call('spv', `${base}/spvs`, 'POST', outbound(spvDraft), 'Added')
                if (ok) setSpvDraft({ label: '', purpose: 'other', bw_ownership_pct: '' })
              }}
            >
              <Plus className="size-4" />
              Add a vehicle
            </Button>
          </div>
        </FormSection>
      </Panel>

      <Panel className="p-4 sm:p-5">
        <FormSection
          title="Capacity"
          description="Where the megawatts come from. A block design states how the plant is built: 24 blocks of 50 MW at N+4 is 1,000 MW firm, not 1,200."
          collapsible
          defaultOpen={input.sources.length === 0}
        >
          {input.sources.length > 0 ? (
            <ul className="mb-4 space-y-1.5 text-sm">
              {input.sources.map((s) => (
                <li key={s.id} className="group flex items-center justify-between gap-2">
                  <span>
                    {s.label}
                    <span className="text-muted-foreground">
                      {' · '}
                      {CAPACITY_SOURCE_LABELS[s.kind]}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${s.label}`}
                    className="relative rounded p-1 text-muted-foreground opacity-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    onClick={() =>
                      void call('src-del', `${base}/sources/${s.id}`, 'DELETE', undefined, 'Removed')
                    }
                  >
                    <span className="absolute -inset-3" />
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <FormGrid cols={3}>
            <Field id="srclabel" label="Name">
              <Input
                id="srclabel"
                value={sourceDraft.label as string}
                onChange={(e) => setSourceDraft((d) => ({ ...d, label: e.target.value }))}
              />
            </Field>
            <Field id="srckind" label="Kind">
              <Select
                id="srckind"
                value={sourceDraft.kind as string}
                onChange={(e) => setSourceDraft((d) => ({ ...d, kind: e.target.value }))}
              >
                {CAPACITY_SOURCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {CAPACITY_SOURCE_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="srcnameplate" label="Nameplate MW" hint="skip if using a block design">
              <Input
                id="srcnameplate"
                inputMode="decimal"
                value={sourceDraft.nameplate_mw as string}
                onChange={(e) => setSourceDraft((d) => ({ ...d, nameplate_mw: e.target.value }))}
              />
            </Field>
            <Field id="srcavail" label="Availability, %" hint="empty means no derate is claimed">
              <Input
                id="srcavail"
                inputMode="decimal"
                value={sourceDraft.availability_pct as string}
                onChange={(e) => setSourceDraft((d) => ({ ...d, availability_pct: e.target.value }))}
              />
            </Field>
            <Field id="srcblocks" label="Blocks, total">
              <Input
                id="srcblocks"
                inputMode="numeric"
                value={sourceDraft.block_count as string}
                onChange={(e) => setSourceDraft((d) => ({ ...d, block_count: e.target.value }))}
              />
            </Field>
            <Field id="srcredundant" label="Blocks held redundant">
              <Input
                id="srcredundant"
                inputMode="numeric"
                value={sourceDraft.redundant_blocks as string}
                onChange={(e) =>
                  setSourceDraft((d) => ({ ...d, redundant_blocks: e.target.value }))
                }
              />
            </Field>
            <Field id="srcblockmw" label="MW per block">
              <Input
                id="srcblockmw"
                inputMode="decimal"
                value={sourceDraft.block_mw as string}
                onChange={(e) => setSourceDraft((d) => ({ ...d, block_mw: e.target.value }))}
              />
            </Field>
            <Field
              id="srcstated"
              label="Stated net MW"
              hint="what a document claims. Compared, never applied"
            >
              <Input
                id="srcstated"
                inputMode="decimal"
                value={sourceDraft.stated_net_mw as string}
                onChange={(e) => setSourceDraft((d) => ({ ...d, stated_net_mw: e.target.value }))}
              />
            </Field>
          </FormGrid>
          <div className="mt-3">
            <Button
              size="sm"
              variant="outline"
              disabled={busy === 'src' || !(sourceDraft.label as string).trim()}
              onClick={async () => {
                const ok = await call(
                  'src',
                  `${base}/sources`,
                  'POST',
                  outbound(sourceDraft),
                  'Added'
                )
                if (ok)
                  setSourceDraft({
                    label: '',
                    kind: 'grid_interconnect',
                    nameplate_mw: '',
                    availability_pct: '',
                    block_count: '',
                    redundant_blocks: '',
                    block_mw: '',
                    stated_net_mw: '',
                  })
              }}
            >
              <Plus className="size-4" />
              Add a capacity source
            </Button>
          </div>
        </FormSection>
      </Panel>

      <Panel className="p-4 sm:p-5">
        <FormSection
          title="Add a revenue line"
          description="One way this deal earns money. The fields change with the type, because a lease rate and a price per ton are not the same quantity."
          collapsible
          defaultOpen={input.lines.length === 0}
        >
          <FormGrid cols={2}>
            <Field id="linetype" label="Type" className="sm:col-span-2">
              <Select
                id="linetype"
                value={lineType}
                onChange={(e) => {
                  // Clear the draft on a type change: the fields are different,
                  // and carrying a stale $/kWh into a $/ton line is exactly the
                  // unit mix-up this feature exists to prevent.
                  setLineType(e.target.value as RevenueLineType)
                  setLineDraft({})
                  setLineSources({})
                }}
              >
                {REVENUE_LINE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {REVENUE_LINE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            {LINE_COMMON_FIELDS.map(renderLineField)}
            {LINE_FORM_FIELDS[lineType].map(renderLineField)}
          </FormGrid>
          <div className="mt-3">
            <Button
              size="sm"
              disabled={busy === 'line' || !((lineDraft.label as string) ?? '').trim()}
              onClick={async () => {
                const ok = await call(
                  'line',
                  `${base}/lines`,
                  'POST',
                  {
                    ...outbound(lineDraft),
                    line_type: lineType,
                    _sources: Object.keys(lineSources).length > 0 ? lineSources : undefined,
                  },
                  'Line added'
                )
                if (ok) {
                  setLineDraft({})
                  setLineSources({})
                }
              }}
            >
              <Plus className="size-4" />
              Add the line
            </Button>
          </div>
        </FormSection>
      </Panel>

      {input.lines.length > 0 ? (
        <Panel className="p-4 sm:p-5">
          <h2 className="label-caps text-muted-foreground">Remove a line</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {input.lines.map((line) => (
              <li key={line.id} className="group flex items-center justify-between gap-2">
                <span>
                  {line.label}
                  <span className="text-muted-foreground">
                    {' · '}
                    {REVENUE_LINE_LABELS[line.type]}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${line.label}`}
                  className="relative rounded p-1 text-muted-foreground opacity-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  onClick={() =>
                    void call('line-del', `${base}/lines/${line.id}`, 'DELETE', undefined, 'Removed')
                  }
                >
                  <span className="absolute -inset-3" />
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Removing a line a fee is charged against leaves the fee with nothing to compute, which
            the model reports beside that fee rather than deleting it for you.
          </p>
        </Panel>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        Sourcing is recorded per field. Every figure above currently reads as{' '}
        {result.status ? PROVENANCE_LABELS[result.status].toLowerCase() : 'unsourced'}, the weakest
        of {PROVENANCE_ORDER.length} levels.
      </p>
    </div>
  )
}
