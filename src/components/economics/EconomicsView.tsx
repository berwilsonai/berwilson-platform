/**
 * The whole Economics tab, shared by projects and opportunities.
 *
 * ⚠ ONE COMPONENT FOR BOTH RECORD KINDS, WITH A TARGET PARAMETER. Forking it
 * per table is how `runDocumentAiPass` silently discarded 413,000 characters
 * (CLAUDE.md §12, 09-17): two copies drift the moment one is fixed, and the one
 * nobody is looking at is the one that keeps the bug.
 *
 * Server component. The read panels are server-rendered from the same engine
 * call the editor's saves refresh, so there is never a figure on screen that
 * disagrees with the inputs beside it.
 */

import { computeDealEconomics } from '@/lib/economics'
import { loadEconomics } from '@/lib/economics/store'
import { listActiveBenchmarks } from '@/lib/economics/benchmarks'
import type { RecordKind } from '@/lib/records/scope'
import ConfidencePanel from './ConfidencePanel'
import DealSizePanel from './DealSizePanel'
import EconomicsEditor from './EconomicsEditor'
import LedgerPanel from './LedgerPanel'
import LinesPanel from './LinesPanel'
import StartEconomics from './StartEconomics'
import VersionHistory from './VersionHistory'

interface EconomicsViewProps {
  recordKind: RecordKind
  recordId: string
  recordName: string
  canEdit: boolean
}

export default async function EconomicsView({
  recordKind,
  recordId,
  recordName,
  canEdit,
}: EconomicsViewProps) {
  const [loaded, benchmarks] = await Promise.all([
    loadEconomics(recordKind, recordId),
    // Read once here rather than in the client: the library holds a
    // service-role client and must never be imported from a 'use client' file.
    listActiveBenchmarks(),
  ])

  if (!loaded) {
    return (
      <StartEconomics
        recordKind={recordKind}
        recordId={recordId}
        recordName={recordName}
        canEdit={canEdit}
      />
    )
  }

  const result = computeDealEconomics(loaded.input)

  return (
    <div className="space-y-4">
      <DealSizePanel result={result} />
      <LedgerPanel result={result} />
      <LinesPanel result={result} spvs={loaded.input.spvs} />
      <ConfidencePanel result={result} />
      <VersionHistory economicsId={loaded.economicsId} />
      {canEdit ? (
        <EconomicsEditor
          economicsId={loaded.economicsId}
          recordName={recordName}
          input={loaded.input}
          result={result}
          notes={loaded.notes}
          statedShape={loaded.input.statedTotal?.shape ?? null}
          benchmarks={benchmarks}
        />
      ) : null}
    </div>
  )
}
