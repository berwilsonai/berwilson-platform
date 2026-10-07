'use client'

/**
 * One vehicle: what it is, who is in it, and how much of it is ours.
 *
 * ⚠ THE SHARE AT THE TOP IS DERIVED, AND THE CARD SAYS WHICH WAY. With a
 * participant ledger it is the row flagged as Ber Wilson; with no ledger it is
 * the figure typed on the vehicle. Two homes for one quantity is how a reader
 * ends up trusting neither, so the answer names its source in words and a typed
 * figure the ledger has overruled is shown as superseded rather than dropped
 * silently (CLAUDE.md §12).
 */

import { useState } from 'react'
import { Loader2, Pencil, Trash2, TriangleAlert } from 'lucide-react'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/field'
import type { EntityRollup } from '@/lib/economics/capture'
import { PROVENANCE_LABELS, PROVENANCE_ORDER, PROVENANCE_TONES } from '@/lib/economics/provenance'
import { formatMoney, formatValue } from '@/lib/utils/constants'
import { TONE_BADGE } from '@/lib/utils/leads'
import {
  participantTotals,
  resolveBwShare,
  splitWarnings,
  stillToPlace,
} from '@/lib/spvs/ownership'
import {
  SPV_PURPOSES,
  SPV_PURPOSE_LABELS,
  type OrgNodeOption,
  type ProjectSpv,
} from '@/lib/spvs/types'
import ParticipantLedger from './ParticipantLedger'
import { outbound, useApiCall, type Draft } from './use-api-call'

interface SpvCardProps {
  spv: ProjectSpv
  /** The engine's gross and net for this vehicle. Null with no model yet. */
  rollup: EntityRollup | null
  orgNodes: OrgNodeOption[]
  canEdit: boolean
  hasModel: boolean
}

/** Trailing zeros dropped: "35%", not "35.0000%". */
function pct(value: number): string {
  return `${Number(value.toFixed(4))}%`
}

export default function SpvCard({ spv, rollup, orgNodes, canEdit, hasModel }: SpvCardProps) {
  const { busy, call } = useApiCall()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => ({
    label: spv.label,
    purpose: spv.purpose,
    org_node_id: spv.orgNodeId ?? '',
    jurisdiction: spv.jurisdiction ?? '',
    bw_ownership_pct: spv.bwOwnershipPct?.toString() ?? '',
    raise_target: spv.raiseTarget?.toString() ?? '',
    status: spv.status,
    note: spv.note ?? '',
  }))

  const share = resolveBwShare(spv, spv.participants)
  const totals = participantTotals(spv.participants)
  const gap = stillToPlace(spv.raiseTarget, totals.committed)
  const warnings = splitWarnings(spv, spv.participants)
  const hasLedger = spv.participants.length > 0

  async function save() {
    const ok = await call(`spv-${spv.id}`, `/api/spvs/${spv.id}`, 'PATCH', outbound(draft), 'Saved')
    if (ok) setEditing(false)
  }

  return (
    <Panel>
      <PanelHeader label={SPV_PURPOSE_LABELS[spv.purpose]}>
        <div className="flex items-center gap-2">
          <Chip className={TONE_BADGE[PROVENANCE_TONES[spv.status]] ?? TONE_BADGE.slate}>
            {PROVENANCE_LABELS[spv.status]}
          </Chip>
          {canEdit ? (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Edit ${spv.label}`}
                onClick={() => setEditing((v) => !v)}
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove ${spv.label}`}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3" />
              </Button>
            </>
          ) : null}
        </div>
      </PanelHeader>

      <div className="space-y-4 p-4 sm:p-5">
        {/* ── identity and our share ───────────────────────────────────── */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h3 className="font-semibold">{spv.label}</h3>
            <p className="text-xs text-muted-foreground">
              {spv.orgNodeName ? (
                <>In the org chart as {spv.orgNodeName}</>
              ) : (
                <>Not in the org chart yet</>
              )}
              {spv.jurisdiction ? <> · {spv.jurisdiction}</> : null}
            </p>
          </div>
          <div className="text-right">
            {share.pct == null ? (
              // Named in words, never a bare em dash at a value's own weight.
              <p className="text-sm font-medium text-muted-foreground">Our share not set</p>
            ) : (
              <p className="tnum text-lg font-semibold">{pct(share.pct)} ours</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              {share.from === 'ledger'
                ? 'from the participant ledger'
                : share.from === 'typed'
                  ? 'typed on the vehicle'
                  : hasLedger
                    ? 'no participant is marked as ours'
                    : 'nobody has said'}
            </p>
          </div>
        </div>

        {/* ── what the engine makes of it ──────────────────────────────── */}
        {rollup ? (
          <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/30 p-3 sm:grid-cols-4">
            <Figure label="Annual in vehicle" value={rollup.gross.annualRecurringRevenue} />
            <Figure label="Contract value" value={rollup.gross.contractValue} />
            <Figure label="One-time" value={rollup.gross.oneTimeRevenue} />
            {/*
              ⚠ `berWilsonNet` IS NULL WHEN THE SPLIT IS UNSET, and that must
              read as unfinished rather than as zero. A $0 beside a real gross
              figure is a statement about the deal that nobody made.
            */}
            <Figure
              label="Net to us"
              value={rollup.berWilsonNet?.contractValue ?? null}
              emptyLabel={share.pct == null ? 'Undetermined' : 'Nothing yet'}
              strong
            />
          </div>
        ) : hasModel ? null : (
          <p className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
            Nothing is priced on this deal yet, so there is no revenue to split. The structure can
            be settled first — that is why it lives here rather than inside the economics model.
          </p>
        )}

        {/* ── capital ──────────────────────────────────────────────────── */}
        {spv.raiseTarget != null || totals.committed != null || totals.funded != null ? (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            {spv.raiseTarget != null ? (
              <span>
                <span className="text-muted-foreground">Target </span>
                <span className="tnum font-medium">{formatMoney(spv.raiseTarget)}</span>
              </span>
            ) : null}
            {totals.committed != null ? (
              <span>
                <span className="text-muted-foreground">Committed </span>
                <span className="tnum font-medium">{formatMoney(totals.committed)}</span>
                <span className="text-muted-foreground">
                  {' '}
                  from {totals.withCommitted} of {spv.participants.length}
                </span>
              </span>
            ) : null}
            {totals.funded != null ? (
              <span>
                <span className="text-muted-foreground">Funded </span>
                <span className="tnum font-medium">{formatMoney(totals.funded)}</span>
              </span>
            ) : null}
            {gap != null && gap > 0 ? (
              <span className="text-muted-foreground">
                <span className="tnum">{formatValue(gap)}</span> still to place
              </span>
            ) : null}
          </div>
        ) : null}

        {/* ── what is not yet agreed ───────────────────────────────────── */}
        {warnings.length > 0 ? (
          <ul className="space-y-1.5">
            {warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-2 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {/* ── the edit form ────────────────────────────────────────────── */}
        {editing && canEdit ? (
          <div className="space-y-3 rounded-md bg-muted/30 p-3">
            <FormGrid cols={3}>
              <Field id={`label-${spv.id}`} label="Name" required>
                <Input
                  id={`label-${spv.id}`}
                  value={draft.label as string}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                />
              </Field>
              <Field id={`purpose-${spv.id}`} label="Purpose">
                <Select
                  id={`purpose-${spv.id}`}
                  value={draft.purpose as string}
                  onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))}
                >
                  {SPV_PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {SPV_PURPOSE_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`status-${spv.id}`} label="Status">
                <Select
                  id={`status-${spv.id}`}
                  value={draft.status as string}
                  onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                >
                  {PROVENANCE_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {PROVENANCE_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id={`orgnode-${spv.id}`}
                label="In the org chart as"
                hint="leave empty until the entity exists"
                // A native select sizes to its widest option, so one long
                // entity name would stretch the column (§12).
                className="min-w-0"
              >
                <Select
                  id={`orgnode-${spv.id}`}
                  className="max-w-full"
                  value={draft.org_node_id as string}
                  onChange={(e) => setDraft((d) => ({ ...d, org_node_id: e.target.value }))}
                >
                  <option value="">Not in the chart yet</option>
                  {orgNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                      {node.under ? ` — ${node.under}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`juris-${spv.id}`} label="Jurisdiction">
                <Input
                  id={`juris-${spv.id}`}
                  placeholder="Utah"
                  value={draft.jurisdiction as string}
                  onChange={(e) => setDraft((d) => ({ ...d, jurisdiction: e.target.value }))}
                />
              </Field>
              <Field id={`target-${spv.id}`} label="Raise target">
                <Input
                  id={`target-${spv.id}`}
                  inputMode="decimal"
                  placeholder="20,000,000"
                  value={draft.raise_target as string}
                  onChange={(e) => setDraft((d) => ({ ...d, raise_target: e.target.value }))}
                />
              </Field>
              {/*
                ⚠ THE TYPED SHARE IS OFFERED ONLY WITH AN EMPTY LEDGER. Once a
                participant carries a split, the ledger is the definition and a
                second editable field for the same quantity would invite a
                disagreement the reader cannot resolve.
              */}
              {hasLedger ? (
                <div className="sm:col-span-2">
                  <p className="label-caps text-muted-foreground">Ber Wilson share</p>
                  <p className="mt-1 text-sm">
                    Read from the participant marked as Ber Wilson below, so there is nothing to
                    type here.
                    {spv.bwOwnershipPct != null ? (
                      <>
                        {' '}
                        A figure of {pct(spv.bwOwnershipPct)} is still stored on the vehicle from
                        before the ledger existed; it is not being used.
                      </>
                    ) : null}
                  </p>
                </div>
              ) : (
                <Field
                  id={`bwpct-${spv.id}`}
                  label="Ber Wilson share, %"
                  hint="leave empty if undecided — empty is not zero"
                >
                  <Input
                    id={`bwpct-${spv.id}`}
                    inputMode="decimal"
                    value={draft.bw_ownership_pct as string}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, bw_ownership_pct: e.target.value }))
                    }
                  />
                </Field>
              )}
              <Field id={`note-${spv.id}`} label="Note" className="sm:col-span-3">
                <Textarea
                  id={`note-${spv.id}`}
                  rows={2}
                  value={draft.note as string}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                />
              </Field>
            </FormGrid>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={busy === `spv-${spv.id}` || !(draft.label as string).trim()}
                onClick={() => void save()}
              >
                {busy === `spv-${spv.id}` ? <Loader2 className="size-4 animate-spin" /> : null}
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <ParticipantLedger spv={spv} canEdit={canEdit} />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Remove ${spv.label}?`}
        description="Its participants and their splits go with it. Both are recoverable from the activity log, which keeps a copy of every deleted row. Revenue lines earned in this vehicle will block the removal rather than quietly becoming wholly ours."
        confirmLabel="Remove the vehicle"
        destructive
        onConfirm={() => {
          void call(`del-${spv.id}`, `/api/spvs/${spv.id}`, 'DELETE', undefined, 'Removed')
        }}
      />
    </Panel>
  )
}

/**
 * One money figure, or a named absence.
 *
 * ⚠ A BARE EM DASH AT A VALUE'S OWN WEIGHT READS AS A FAILED RENDER (§12), so
 * an absent figure is named in words at the weight of a label instead.
 */
function Figure({
  label,
  value,
  emptyLabel = 'Not set',
  strong = false,
}: {
  label: string
  value: number | null
  emptyLabel?: string
  strong?: boolean
}) {
  return (
    <div>
      <p className="label-caps text-muted-foreground">{label}</p>
      {value == null ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <p className={`tnum mt-0.5 ${strong ? 'font-semibold' : 'font-medium'}`}>
          {formatValue(value)}
        </p>
      )}
    </div>
  )
}
