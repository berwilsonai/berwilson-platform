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
import { calcDb, type InputProposalRow } from '@/lib/economics/db'
import { createAdminClient } from '@/lib/supabase/admin'
import ProposalsPanel, { type ProposalView } from './ProposalsPanel'
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

  // What the AI has proposed and nobody has decided, plus how many documents
  // there are to read. Both, because "no proposals" from no documents and "no
  // proposals" from six documents are different facts about this deal.
  const [proposalRows, documentCount] = await Promise.all([
    calcDb()
      .from('economics_input_proposals')
      .select('*')
      .eq('economics_id', loaded.economicsId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(200),
    countReadableDocuments(recordKind, recordId),
  ])
  if (proposalRows.error) {
    console.error('[economics] could not read proposals:', proposalRows.error.message)
  }
  const proposals: ProposalView[] = ((proposalRows.data ?? []) as InputProposalRow[]).map((p) => ({
    id: p.id,
    field_key: p.field_key,
    proposed_value: p.proposed_value,
    proposed_unit: p.proposed_unit,
    proposed_line_type: p.proposed_line_type,
    proposed_label: p.proposed_label,
    source_quote: p.source_quote,
    confidence: p.confidence,
    reasoning: p.reasoning,
  }))

  return (
    <div className="space-y-4">
      <DealSizePanel result={result} />
      <LedgerPanel result={result} />
      <LinesPanel result={result} spvs={loaded.input.spvs} />
      <ConfidencePanel result={result} />
      <ProposalsPanel
        economicsId={loaded.economicsId}
        proposals={proposals}
        documentCount={documentCount}
      />
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

/**
 * Documents on this record that actually hold text an extraction could read.
 *
 * ⚠ `superseded_at is null` on the project side, or the graveyard reads as
 * live content: ten documents once looked like an indexing gap and every one
 * was a deliberately retired duplicate whose live twin was indexed.
 */
async function countReadableDocuments(kind: RecordKind, recordId: string): Promise<number> {
  const db = createAdminClient()
  if (kind === 'project') {
    const { count } = await db
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', recordId)
      .is('superseded_at', null)
      .not('extracted_text', 'is', null)
    return count ?? 0
  }
  const { count } = await db
    .from('opportunity_documents')
    .select('id', { count: 'exact', head: true })
    .eq('opportunity_id', recordId)
    .not('extracted_text', 'is', null)
  return count ?? 0
}
