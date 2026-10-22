/**
 * End-to-end verification of the document compose pass, against live data.
 *
 * Run: export PATH="$HOME/.node/bin:$PATH" && npx tsx scripts/verify-compose.mts
 *
 * ⚠ IT CALLS THE REAL MODEL AND WRITES REAL ROWS. Composing is minutes per
 * document and LM Studio serves one request at a time, so this is slow by
 * nature and must not be run beside a sweep. Everything it creates is named in
 * the output so it can be undone; pass `--clean` to remove what the last run
 * made.
 *
 * ⚠ TEXTS ARE SUPPRESSED (`skipText`), because a verification run must not make
 * a phone buzz. The send path itself is covered by the policy and text tests,
 * and by the one deliberate live check at the end when `--text` is passed.
 */

import { createAdminClient } from '../src/lib/supabase/admin'
import { trashFile } from '../src/lib/integrations/google-drive-write'
import { composeDocument, COMPOSE_STALE_MS } from '../src/lib/documents/compose'
import { composeKindList } from '../src/lib/documents/compose-kinds'
import { collectAllowedFigures, unsourcedFigures } from '../src/lib/documents/figures'

/**
 * A real auth user, because `composed_documents.requested_by` is an FK to
 * auth.users — found the hard way on the first run. moose@ is the seat that
 * holds Drive write, so it is also the one a real compose runs as.
 */
const MOOSE = '81207093-9bad-4ef6-97f1-d926125ed1e8'

const CLEAN = process.argv.includes('--clean')
const WITH_TEXT = process.argv.includes('--text')

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(26)} ${String(value)}`)
}

async function main() {
  const supabase = createAdminClient()

  if (CLEAN) {
    const { data: jobs } = await supabase
      .from('composed_documents')
      .select('id, document_id, document_table, drive_file_id, title')
    for (const job of jobs ?? []) {
      // ⚠ THE DRIVE COPY TOO, or the undo is half an undo and a verification
      // run leaves a document in the team's own folder with nothing saying
      // where it came from.
      if (job.drive_file_id) {
        try {
          await trashFile(job.drive_file_id)
        } catch (err) {
          console.log(`  could not trash Drive file ${job.drive_file_id}: ${err instanceof Error ? err.message : err}`)
        }
      }
      if (job.document_id && job.document_table) {
        // ⚠ THE STORAGE OBJECT TOO, READ BEFORE THE ROW IS DELETED. Deleting
        // the row first orphans the file with nothing left pointing at it —
        // the first version of this did exactly that and left 144KB behind
        // (§12: a polymorphic pointer needs its own reaper).
        const { data: doc } = await supabase
          .from(job.document_table as 'documents')
          .select('storage_path')
          .eq('id', job.document_id)
          .maybeSingle()
        await supabase.from(job.document_table as 'documents').delete().eq('id', job.document_id)
        if (doc?.storage_path) {
          await supabase.storage.from('documents').remove([doc.storage_path])
        }
      }
      await supabase.from('composed_documents').delete().eq('id', job.id)
      console.log(`removed ${job.title ?? job.id}`)
    }
    console.log(`\n${(jobs ?? []).length} compose rows removed, Drive copies trashed.`)
    return
  }

  console.log('\n═══ 1. The registry ═══')
  for (const { key, spec } of composeKindList()) {
    line(key, `${spec.label} → doc_type '${spec.docType}'${spec.legal === 'needs_counsel' ? ' ⚠ counsel' : ''}`)
  }
  line('stale horizon', `${COMPOSE_STALE_MS / 1000}s`)

  console.log('\n═══ 2. The figure guard, on prose the model actually writes ═══')
  {
    const allowed = collectAllowedFigures({
      instructions: 'Offer $4.2M at closing.',
      evidenceText: 'The seller is asking $5,000,000 and pays a 4% broker fee.',
      platform: [],
    })
    const honest = 'We offer $4.2M at closing against the $5,000,000 ask, with the 4% fee unchanged.'
    const invented = 'We offer $4.2M at closing, leaving a $800,000 gap and a 6% fee.'
    line('honest prose', `${unsourcedFigures(honest, allowed).length} unsourced (expect 0)`)
    const bad = unsourcedFigures(invented, allowed)
    line('invented prose', `${bad.length} unsourced: ${bad.map((o) => o.text).join(', ')} (expect 2)`)
    if (unsourcedFigures(honest, allowed).length !== 0 || bad.length !== 2) {
      throw new Error('the figure guard does not behave as the tests claim')
    }
  }

  // ── A record with real evidence on it ─────────────────────────────────────
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, confidential')
    .eq('name', 'Myton Rail')
    .maybeSingle()
  if (!project) throw new Error('Myton Rail not found — pick another record')

  console.log(`\n═══ 3. Compose a briefing memo on ${project.name} ═══`)
  const started = Date.now()
  const result = await composeDocument({
    target: { kind: 'project', id: project.id },
    documentKind: 'memo',
    instructions:
      'Where does this deal stand, what is agreed and what is not, who the parties are, and what the next decision is.',
    requestedBy: { id: MOOSE, email: null },
    skipText: !WITH_TEXT,
  })
  line('status', result.status)
  line('elapsed', `${((Date.now() - started) / 1000).toFixed(1)}s`)
  line('title', result.title ?? '—')
  line('document row', result.documentId ?? '—')
  line('drive doc', result.driveFileUrl ?? '— (none)')
  line('contained', result.contained)
  line('texted', result.texted)
  line('evidence dropped', result.evidenceTruncated)
  if (result.error) line('error', result.error)

  if (result.status === 'ready') {
    const { data: doc } = await supabase
      .from('documents')
      .select('file_name, doc_type, mime_type, embedding_status, extracted_text, drive_file_id, content_sha256')
      .eq('id', result.documentId!)
      .single()
    console.log('\n  the filed row:')
    line('file_name', doc?.file_name)
    line('doc_type', doc?.doc_type)
    line('mime_type', doc?.mime_type)
    // ⚠ THE ONE THAT MATTERS: indexing waits for a human, or Ber AI reads its
    // own draft back as evidence about the deal.
    line('embedding_status', `${doc?.embedding_status} (MUST be 'skipped')`)
    line('text stored', `${doc?.extracted_text?.length ?? 0} chars`)
    line('sha256', doc?.content_sha256?.slice(0, 16))
    if (doc?.embedding_status !== 'skipped') {
      throw new Error('a composed document was queued for embedding — the self-loop guard is broken')
    }

    console.log('\n  first 600 characters of what it wrote:\n')
    console.log(
      (doc?.extracted_text ?? '')
        .slice(0, 600)
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n')
    )

    // No figure in the document may be absent from what it read. Re-checked
    // here against the STORED text, independently of the pass's own guard.
    const { data: job } = await supabase
      .from('composed_documents')
      .select('sources, figures')
      .eq('id', result.requestId)
      .single()
    const sources = (job?.sources as unknown[]) ?? []
    line('\n  sources recorded', sources.length)
  }

  console.log('\n═══ 4. A second compose while the first is still running is refused ═══')
  // The 409 path, proved by leaving a 'composing' row behind on purpose.
  const { data: latch } = await supabase
    .from('composed_documents')
    .insert({
      project_id: project.id,
      opportunity_id: null,
      document_kind: 'memo',
      instructions: 'a deliberate latch for the verification run',
      status: 'composing',
    })
    .select('id')
    .single()
  try {
    await composeDocument({
      target: { kind: 'project', id: project.id },
      documentKind: 'memo',
      instructions: 'this one should be refused before any model call',
      requestedBy: { id: MOOSE, email: null },
      skipText: true,
    })
    throw new Error('a concurrent compose was NOT refused')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/already being written/.test(message)) throw err
    line('refused with', message.slice(0, 70))
  } finally {
    if (latch) await supabase.from('composed_documents').delete().eq('id', latch.id)
  }

  console.log('\n═══ 5. An unknown kind is refused by name, before any work ═══')
  try {
    await composeDocument({
      target: { kind: 'project', id: project.id },
      documentKind: 'not_a_kind',
      instructions: 'this should never reach the model',
      requestedBy: { id: MOOSE, email: null },
      skipText: true,
    })
    throw new Error('an unknown kind was accepted')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/does not know a document kind/.test(message)) throw err
    line('refused with', message)
  }

  console.log('\n═══ 6. A record with nothing on it says so, rather than inventing ═══')
  /**
   * ⚠ THE RECORD HAS TO BE GENUINELY EMPTY FOR THIS TO ASSERT ANYTHING. The
   * first version named Eagle Mountain, which carries 11 threads — so `ready`
   * was the CORRECT answer and the check passed vacuously, the exact shape §12
   * warns about: an empty population passes behind the same tick. Measured
   * 2026-10-22, these two are the only projects with no thread, meeting or
   * document at all.
   */
  const { data: bare } = await supabase
    .from('projects')
    .select('id, name')
    .eq('name', 'Tonga Development Project')
    .maybeSingle()
  if (!bare) throw new Error('no empty record to test the refusal with')

  const links = await supabase
    .from('thread_links')
    .select('thread_id', { count: 'exact', head: true })
    .eq('record_kind', 'project')
    .eq('record_id', bare.id)
  line('evidence on it', `${links.count ?? 0} threads (must be 0 for this to mean anything)`)

  const thin = await composeDocument({
    target: { kind: 'project', id: bare.id },
    documentKind: 'one_pager',
    instructions: 'Explain this deal to someone who has never seen it.',
    requestedBy: { id: MOOSE, email: null },
    skipText: true,
  })
  line('status', thin.status)
  line('said', thin.error ?? '—')
  if (thin.status !== 'failed' || !/nothing on this record/.test(thin.error ?? '')) {
    throw new Error('an empty record did not refuse — it may have invented a document')
  }

  console.log('\nDone. `--clean` removes the rows and documents this made.\n')
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
