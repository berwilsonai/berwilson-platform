/**
 * The whole Vehicles tab, shared by projects and opportunities.
 *
 * ⚠ ONE COMPONENT FOR BOTH RECORD KINDS, WITH A TARGET PARAMETER. Forking it
 * per table is how `runDocumentAiPass` silently discarded 413,000 characters
 * (CLAUDE.md §12, 09-17): two copies drift the moment one is fixed, and the one
 * nobody is looking at is the one that keeps the bug.
 *
 * Server component. Every money figure here comes from the economics engine, so
 * the board below refreshes the route after each save rather than keeping its
 * own idea of the answer — one engine, one number on the screen.
 */

import { Boxes } from 'lucide-react'
import { computeDealEconomics } from '@/lib/economics'
import { loadEconomics } from '@/lib/economics/store'
import type { EntityRollup } from '@/lib/economics/capture'
import type { RecordKind } from '@/lib/records/scope'
import { loadProjectSpvs } from '@/lib/spvs/queries'
import { spvDb } from '@/lib/spvs/db'
import type { OrgNodeOption } from '@/lib/spvs/types'
import VehiclesBoard from './VehiclesBoard'

interface VehiclesViewProps {
  recordKind: RecordKind
  recordId: string
  recordName: string
  canEdit: boolean
}

export default async function VehiclesView({
  recordKind,
  recordId,
  recordName,
  canEdit,
}: VehiclesViewProps) {
  const [spvs, loaded, orgNodes] = await Promise.all([
    loadProjectSpvs(recordKind, recordId),
    // The model may not exist — the whole point of moving vehicles off it is
    // that structure is settled before anything is priced. No model simply
    // means no money to show per vehicle yet.
    loadEconomics(recordKind, recordId),
    listOrgNodes(),
  ])

  // ⚠ `byEntity` IS COMPUTED BY THE ENGINE AND, UNTIL NOW, WAS RENDERED BY NO
  // SCREEN. It is the figure that answers "how much of the Energy SPV is ours
  // in dollars" — gross in the vehicle, and net of our share of it.
  const rollups = new Map<string, EntityRollup>()
  if (loaded) {
    for (const entry of computeDealEconomics(loaded.input).byEntity) {
      if (entry.spvId) rollups.set(entry.spvId, entry)
    }
  }

  return (
    <div className="space-y-6 py-6">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-900/40">
          <Boxes size={20} className="text-slate-500 dark:text-slate-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Vehicles</h1>
          <p className="text-sm text-muted-foreground">
            The SPVs this deal is held in, who is in each one, and for how much. A vehicle here is
            a structure, not a legal entity — no company is formed and no ownership split is
            assumed until someone says so.
          </p>
        </div>
      </div>

      <VehiclesBoard
        recordKind={recordKind}
        recordId={recordId}
        recordName={recordName}
        canEdit={canEdit}
        spvs={spvs}
        rollups={Object.fromEntries(rollups)}
        orgNodes={orgNodes}
        hasModel={loaded != null}
      />
    </div>
  )
}

/**
 * The SPV and division nodes from the corporate org chart, for the link picker.
 *
 * Read here rather than in the client: `spvDb` holds a service-role client and
 * must never be imported from a `'use client'` file (CLAUDE.md §12 — every
 * export of a client module becomes a client reference, and the failure is at
 * REQUEST time, which neither `tsc` nor the build catches).
 */
async function listOrgNodes(): Promise<OrgNodeOption[]> {
  const { data, error } = await spvDb()
    .from('org_nodes')
    .select('id,name,kind,parent_id')
    .order('sort_order')
    .limit(1000)
  if (error) {
    // Said out loud, not swallowed. An empty picker is survivable — the link is
    // optional — but a silently empty one reads as "the chart has no SPVs".
    console.error('[spvs] could not read the org chart for the picker:', error.message)
    return []
  }

  const rows = (data ?? []) as { id: string; name: string; kind: string; parent_id: string | null }[]
  const names = new Map(rows.map((r) => [r.id, r.name]))
  return rows
    .filter((r) => r.kind === 'spv')
    .map((r) => ({
      id: r.id,
      name: r.name,
      under: r.parent_id ? (names.get(r.parent_id) ?? null) : null,
    }))
}
