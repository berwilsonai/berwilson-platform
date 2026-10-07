'use client'

/**
 * Who is in a vehicle, for how much of it, and how much they have put in.
 *
 * ⚠ ONE LEDGER ANSWERS ALL THREE QUESTIONS, because they are one set of facts.
 * `equity_pct` is the split, `capital_committed` and `capital_funded` are the
 * raise. Keeping the raise in a second place would mean two numbers for one
 * commitment and a rule about which wins — and the two would drift, because one
 * of them is always the one nobody updates.
 *
 * ⚠ THE BER WILSON ROW IS A FLAG, NOT A NAME. "Ber Wilson" appears in the name
 * of half the entities in this business, and matching on a name is how a
 * matcher resolved the reader himself as a counterparty (CLAUDE.md §12, 09-25).
 * The database allows at most one flagged row per vehicle.
 */

import { useState } from 'react'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, FormGrid, Input, Select } from '@/components/ui/field'
import { PROVENANCE_LABELS, PROVENANCE_ORDER, PROVENANCE_TONES } from '@/lib/economics/provenance'
import { formatMoney } from '@/lib/utils/constants'
import { TONE_BADGE } from '@/lib/utils/leads'
import { participantTotals } from '@/lib/spvs/ownership'
import {
  SPV_CLASSES,
  SPV_CLASS_LABELS,
  SPV_ROLES,
  SPV_ROLE_LABELS,
  type ProjectSpv,
  type SpvParticipant,
} from '@/lib/spvs/types'
import { outbound, useApiCall, type Draft } from './use-api-call'

interface ParticipantLedgerProps {
  spv: ProjectSpv
  canEdit: boolean
}

function emptyDraft(): Draft {
  return {
    holder_name: '',
    role: 'capital_partner',
    class: 'membership_units',
    is_ber_wilson: false,
    equity_pct: '',
    capital_committed: '',
    capital_funded: '',
    preferred_return_pct: '',
    status: 'planning_assumption',
  }
}

function draftFrom(p: SpvParticipant): Draft {
  return {
    holder_name: p.holderName,
    role: p.role,
    class: p.class,
    is_ber_wilson: p.isBerWilson,
    equity_pct: p.equityPct?.toString() ?? '',
    capital_committed: p.capitalCommitted?.toString() ?? '',
    capital_funded: p.capitalFunded?.toString() ?? '',
    preferred_return_pct: p.preferredReturnPct?.toString() ?? '',
    status: p.status,
  }
}

/** Trailing zeros dropped: "35%", not "35.0000%". */
function pct(value: number | null): string | null {
  return value == null ? null : `${Number(value.toFixed(4))}%`
}

export default function ParticipantLedger({ spv, canEdit }: ParticipantLedgerProps) {
  const { busy, call } = useApiCall()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [deleteTarget, setDeleteTarget] = useState<SpvParticipant | null>(null)

  const totals = participantTotals(spv.participants)
  const base = `/api/spvs/${spv.id}/participants`
  const hasOurs = spv.participants.some((p) => p.isBerWilson)

  async function save() {
    const editing = editingId != null
    const ok = await call(
      'participant',
      editing ? `${base}/${editingId}` : base,
      editing ? 'PATCH' : 'POST',
      outbound(draft),
      editing ? 'Saved' : 'Added'
    )
    if (ok) {
      setDraft(emptyDraft())
      setAdding(false)
      setEditingId(null)
    }
  }

  function startAdd() {
    // Default the new row to Ber Wilson when nobody holds that flag yet: it is
    // the row that decides our share, so it is the one most worth prompting
    // for, and the constraint stops a second one.
    setDraft({ ...emptyDraft(), is_ber_wilson: !hasOurs, role: hasOurs ? 'capital_partner' : 'sponsor' })
    setEditingId(null)
    setAdding(true)
  }

  function startEdit(p: SpvParticipant) {
    setDraft(draftFrom(p))
    setEditingId(p.id)
    setAdding(true)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="label-caps text-muted-foreground">
          Participants{' '}
          <span className="tnum font-medium normal-case tracking-normal">
            {spv.participants.length}
          </span>
        </h4>
        {canEdit ? (
          <Button size="xs" variant="ghost" onClick={startAdd}>
            <Plus className="size-3" />
            Add
          </Button>
        ) : null}
      </div>

      {spv.participants.length === 0 ? (
        <p className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
          Nobody is recorded in this vehicle yet, so our share is whatever is typed on it above.
          Adding participants makes the ledger the definition instead.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <Th>Participant</Th>
                <Th className="hidden sm:table-cell">Role</Th>
                <Th numeric>Equity</Th>
                <Th numeric className="hidden sm:table-cell">
                  Committed
                </Th>
                <Th numeric className="hidden sm:table-cell">
                  Funded
                </Th>
                <Th className="hidden md:table-cell">Status</Th>
                {canEdit ? <th className="w-16" /> : null}
              </tr>
            </thead>
            <tbody>
              {spv.participants.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{p.holderName}</span>
                    {p.isBerWilson ? (
                      <Chip className={`${TONE_BADGE.emerald} ml-2`}>Ours</Chip>
                    ) : null}
                    {/*
                      The role again, for the phone where its own column is
                      hidden. `aria-hidden` because BOTH copies are in the DOM
                      and only CSS hides one — a screen reader would otherwise
                      read "Avant Capital, capital partner, capital partner".
                    */}
                    <span
                      aria-hidden="true"
                      className="block text-xs text-muted-foreground sm:hidden"
                    >
                      {SPV_ROLE_LABELS[p.role]}
                    </span>
                  </td>
                  <td className="hidden py-2 pr-3 text-muted-foreground sm:table-cell">
                    {SPV_ROLE_LABELS[p.role]}
                  </td>
                  <td className="tnum py-2 pr-3 text-right">
                    {pct(p.equityPct) ?? <Absent>not set</Absent>}
                  </td>
                  <td className="tnum hidden py-2 pr-3 text-right sm:table-cell">
                    {p.capitalCommitted == null ? (
                      <Absent>none</Absent>
                    ) : (
                      formatMoney(p.capitalCommitted)
                    )}
                  </td>
                  <td className="tnum hidden py-2 pr-3 text-right sm:table-cell">
                    {p.capitalFunded == null ? <Absent>none</Absent> : formatMoney(p.capitalFunded)}
                  </td>
                  <td className="hidden py-2 pr-3 md:table-cell">
                    <Chip className={TONE_BADGE[PROVENANCE_TONES[p.status]] ?? TONE_BADGE.slate}>
                      {PROVENANCE_LABELS[p.status]}
                    </Chip>
                  </td>
                  {canEdit ? (
                    <td className="py-2">
                      {/*
                        Never hover-only below `sm`: a control that appears on
                        hover does not exist on a phone (CLAUDE.md §12).
                      */}
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Edit ${p.holderName}`}
                          onClick={() => startEdit(p)}
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Remove ${p.holderName}`}
                          onClick={() => setDeleteTarget(p)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="py-2 pr-3 text-muted-foreground">Totals</td>
                <td className="hidden sm:table-cell" />
                {/*
                  ⚠ A SUM WITH NOTHING IN IT IS NULL, NOT 0. A "0%" or "$0"
                  under a real ledger reads as computed rather than unfinished,
                  which is a claim about the deal that nobody made.
                */}
                <td className="tnum py-2 pr-3 text-right">
                  {pct(totals.equityPct) ?? <Absent>—</Absent>}
                </td>
                <td className="tnum hidden py-2 pr-3 text-right sm:table-cell">
                  {totals.committed == null ? <Absent>—</Absent> : formatMoney(totals.committed)}
                </td>
                <td className="tnum hidden py-2 pr-3 text-right sm:table-cell">
                  {totals.funded == null ? <Absent>—</Absent> : formatMoney(totals.funded)}
                </td>
                <td className="hidden md:table-cell" />
                {canEdit ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {adding && canEdit ? (
        <div className="space-y-3 rounded-md bg-muted/30 p-3">
          <FormGrid cols={3}>
            <Field id={`pname-${spv.id}`} label="Participant" required>
              <Input
                id={`pname-${spv.id}`}
                placeholder="Avant Capital"
                value={draft.holder_name as string}
                onChange={(e) => setDraft((d) => ({ ...d, holder_name: e.target.value }))}
              />
            </Field>
            <Field id={`prole-${spv.id}`} label="Role">
              <Select
                id={`prole-${spv.id}`}
                value={draft.role as string}
                onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
              >
                {SPV_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {SPV_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={`pclass-${spv.id}`} label="Interest">
              <Select
                id={`pclass-${spv.id}`}
                value={draft.class as string}
                onChange={(e) => setDraft((d) => ({ ...d, class: e.target.value }))}
              >
                {SPV_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {SPV_CLASS_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id={`pequity-${spv.id}`}
              label="Equity, %"
              hint="empty means not agreed, which is not zero"
            >
              <Input
                id={`pequity-${spv.id}`}
                inputMode="decimal"
                value={draft.equity_pct as string}
                onChange={(e) => setDraft((d) => ({ ...d, equity_pct: e.target.value }))}
              />
            </Field>
            <Field id={`pcommitted-${spv.id}`} label="Capital committed">
              <Input
                id={`pcommitted-${spv.id}`}
                inputMode="decimal"
                placeholder="14,000,000"
                value={draft.capital_committed as string}
                onChange={(e) => setDraft((d) => ({ ...d, capital_committed: e.target.value }))}
              />
            </Field>
            <Field id={`pfunded-${spv.id}`} label="Capital funded">
              <Input
                id={`pfunded-${spv.id}`}
                inputMode="decimal"
                value={draft.capital_funded as string}
                onChange={(e) => setDraft((d) => ({ ...d, capital_funded: e.target.value }))}
              />
            </Field>
            <Field
              id={`ppref-${spv.id}`}
              label="Preferred return, %"
              hint="if they have one"
            >
              <Input
                id={`ppref-${spv.id}`}
                inputMode="decimal"
                value={draft.preferred_return_pct as string}
                onChange={(e) => setDraft((d) => ({ ...d, preferred_return_pct: e.target.value }))}
              />
            </Field>
            <Field
              id={`pstatus-${spv.id}`}
              label="How firm is this"
              hint="the weakest row sets the vehicle's own confidence"
            >
              <Select
                id={`pstatus-${spv.id}`}
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
            <Field id={`pours-${spv.id}`} label="Is this Ber Wilson?">
              <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                <input
                  id={`pours-${spv.id}`}
                  type="checkbox"
                  className="size-4 rounded border-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  checked={draft.is_ber_wilson === true}
                  onChange={(e) => setDraft((d) => ({ ...d, is_ber_wilson: e.target.checked }))}
                />
                <span className="text-muted-foreground">
                  Our share is read from this row
                </span>
              </label>
            </Field>
          </FormGrid>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy === 'participant' || !(draft.holder_name as string).trim()}
              onClick={() => void save()}
            >
              {busy === 'participant' ? <Loader2 className="size-4 animate-spin" /> : null}
              {editingId ? 'Save' : 'Add'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false)
                setEditingId(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={deleteTarget ? `Remove ${deleteTarget.holderName}?` : 'Remove participant?'}
        description="Their split and capital go with them. The row is recoverable from the activity log, which keeps a copy of every deleted record."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          const target = deleteTarget
          if (!target) return
          void call('participant-del', `${base}/${target.id}`, 'DELETE', undefined, 'Removed')
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}

function Th({
  children,
  numeric = false,
  className = '',
}: {
  children?: React.ReactNode
  numeric?: boolean
  className?: string
}) {
  return (
    <th
      className={`label-caps py-2 pr-3 font-semibold text-muted-foreground ${numeric ? 'text-right' : ''} ${className}`}
    >
      {children}
    </th>
  )
}

/** A named absence, at the weight of a label rather than of a value. */
function Absent({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-normal text-muted-foreground/70">{children}</span>
}
