'use client'

/**
 * The vehicle board: one card per SPV, plus the two ways to add one.
 *
 * The money on each card is server-rendered from the economics engine, so every
 * save ends in `router.refresh()` rather than this component keeping its own
 * idea of the answer. One engine, one number on the screen.
 *
 * Clearing a field sends null, never 0 — see `outbound` in ./use-api-call.
 */

import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Panel } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, FormGrid, FormSection, Input, Select } from '@/components/ui/field'
import type { EntityRollup } from '@/lib/economics/capture'
import type { RecordKind } from '@/lib/records/scope'
import {
  DEFAULT_SPV_PURPOSES,
  SPV_PURPOSES,
  SPV_PURPOSE_LABELS,
  type OrgNodeOption,
  type ProjectSpv,
} from '@/lib/spvs/types'
import SpvCard from './SpvCard'
import { outbound, useApiCall, type Draft } from './use-api-call'

interface VehiclesBoardProps {
  recordKind: RecordKind
  recordId: string
  recordName: string
  canEdit: boolean
  spvs: ProjectSpv[]
  /** Keyed by spv id. Absent when this deal has no economics model yet. */
  rollups: Record<string, EntityRollup>
  orgNodes: OrgNodeOption[]
  hasModel: boolean
}

export default function VehiclesBoard({
  recordKind,
  recordId,
  recordName,
  canEdit,
  spvs,
  rollups,
  orgNodes,
  hasModel,
}: VehiclesBoardProps) {
  const { busy, call } = useApiCall()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>({ label: '', purpose: 'other', raise_target: '' })

  const scope = recordKind === 'project' ? { project_id: recordId } : { opportunity_id: recordId }

  async function addStandard() {
    const ok = await call('standard', '/api/spvs/standard', 'POST', {
      ...scope,
      prefix: recordName,
    })
    if (ok) setAdding(false)
  }

  async function addOne() {
    const ok = await call('add', '/api/spvs', 'POST', { ...scope, ...outbound(draft) }, 'Added')
    if (ok) {
      setDraft({ label: '', purpose: 'other', raise_target: '' })
      setAdding(false)
    }
  }

  const missingStandard = DEFAULT_SPV_PURPOSES.filter(
    (p) => !spvs.some((s) => s.purpose === p)
  )

  return (
    <div className="space-y-4">
      {spvs.length === 0 ? (
        <Panel className="p-4 sm:p-5">
          <p className="text-sm">
            This deal has no vehicles yet, so every revenue line is earned by Ber Wilson
            Corporation and is wholly ours.
          </p>
          {canEdit ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={busy === 'standard'}
                onClick={() => void addStandard()}
              >
                {busy === 'standard' ? <Loader2 className="size-4 animate-spin" /> : null}
                Set up Land, Energy and Data Center
              </Button>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Structures only. No legal entity is created, nothing is linked to the org chart,
                and no ownership split is assumed.
              </p>
            </>
          ) : null}
        </Panel>
      ) : (
        spvs.map((spv) => (
          <SpvCard
            key={spv.id}
            spv={spv}
            rollup={rollups[spv.id] ?? null}
            orgNodes={orgNodes}
            canEdit={canEdit}
            hasModel={hasModel}
          />
        ))
      )}

      {canEdit && spvs.length > 0 ? (
        <Panel className="p-4 sm:p-5">
          {adding ? (
            <FormSection
              title="Add a vehicle"
              description="A deal can hold as many as it needs — a second energy SPV is a different name, not a different purpose."
            >
              <FormGrid cols={3}>
                <Field id="newspvlabel" label="Name" required>
                  <Input
                    id="newspvlabel"
                    value={draft.label as string}
                    placeholder={`${recordName} Housing LLC`}
                    onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  />
                </Field>
                <Field id="newspvpurpose" label="Purpose">
                  <Select
                    id="newspvpurpose"
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
                <Field
                  id="newspvtarget"
                  label="Raise target"
                  hint="what this vehicle needs to raise, if known"
                >
                  <Input
                    id="newspvtarget"
                    inputMode="decimal"
                    placeholder="20,000,000"
                    value={draft.raise_target as string}
                    onChange={(e) => setDraft((d) => ({ ...d, raise_target: e.target.value }))}
                  />
                </Field>
              </FormGrid>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={busy === 'add' || !(draft.label as string).trim()}
                  onClick={() => void addOne()}
                >
                  {busy === 'add' ? <Loader2 className="size-4 animate-spin" /> : null}
                  Add it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                {/*
                  The bootstrap stays reachable after the first vehicle exists.
                  It skips what is already there and counts the skips, so there
                  is no reason to hide it — and hiding it is what made the three
                  standard vehicles a one-chance offer.
                */}
                {missingStandard.length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === 'standard'}
                    onClick={() => void addStandard()}
                  >
                    {busy === 'standard' ? <Loader2 className="size-4 animate-spin" /> : null}
                    Add the {missingStandard.map((p) => SPV_PURPOSE_LABELS[p]).join(' and ')}{' '}
                    {missingStandard.length === 1 ? 'vehicle' : 'vehicles'}
                  </Button>
                ) : null}
              </div>
            </FormSection>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Add a vehicle
            </Button>
          )}
        </Panel>
      ) : null}
    </div>
  )
}
