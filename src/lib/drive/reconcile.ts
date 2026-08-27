/**
 * Nightly reconcile of record documents into Drive.
 *
 * Publishing has existed as a button since the Workspace pass, and the button
 * works. The problem is that nobody presses it: of 15 projects, exactly one had
 * ever been published, so the Drive folder people were told to look in was
 * effectively empty and the feature taught them it was not worth checking.
 *
 * A reading surface that depends on someone remembering to populate it is not a
 * reading surface. This walks every record that has an unpublished document and
 * publishes it, which both drains the existing backlog and keeps it drained
 * without anyone doing anything.
 *
 * Chosen over hooking the three upload routes: those have three different
 * shapes, an upload is not the only way a document arrives, and "it appears in
 * Drive by morning" is an entirely acceptable latency for a reading surface.
 * The button stays for "I need it there now".
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { PRIMARY_MAILBOX, isGoogleConfigured } from '@/lib/integrations/google-workspace'
import {
  DriveScopeError,
  ensureDomainShared,
  ensureRootFolder,
} from '@/lib/integrations/google-drive-write'
import { publishRecordToDrive, type DriveRecordKind } from './publish'

export interface ReconcileResult {
  records: number
  published: number
  uploaded: number
  failed: number
  /** False when the domain-read permission was missing and had to be restored. */
  wasShared: boolean
  errors: string[]
  outOfTime: boolean
}

/** Where an unpublished document points back to, per record kind. */
const SOURCES: Record<DriveRecordKind, { table: 'documents' | 'opportunity_documents'; fk: string }> = {
  project: { table: 'documents', fk: 'project_id' },
  steel: { table: 'documents', fk: 'steel_deal_id' },
  opportunity: { table: 'opportunity_documents', fk: 'opportunity_id' },
}

/**
 * Records with at least one document that has never reached Drive.
 *
 * Deliberately driven by the DOCUMENTS rather than the records: a record with
 * nothing attached needs no folder, and creating one would fill Drive with
 * empty directories that make the useful ones harder to find.
 */
async function pendingRecords(kind: DriveRecordKind): Promise<string[]> {
  const supabase = createAdminClient()
  const src = SOURCES[kind]

  const { data, error } = await supabase
    .from(src.table)
    .select(src.fk)
    .is('drive_published_id', null)
    .not(src.fk, 'is', null)

  if (error) throw new Error(error.message)

  const ids = new Set<string>()
  // The select column is chosen at runtime, so PostgREST's generated types
  // cannot narrow the row shape; the cast is the standard escape here.
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const id = row[src.fk]
    if (typeof id === 'string' && id) ids.add(id)
  }
  return [...ids]
}

export async function reconcileDrivePublishing(
  opts: { budgetMs?: number } = {}
): Promise<ReconcileResult> {
  if (!isGoogleConfigured()) {
    throw new Error('Google Workspace is not configured, so nothing can be published to Drive.')
  }

  const deadline = Date.now() + (opts.budgetMs ?? 20 * 60 * 1000)
  const result: ReconcileResult = {
    records: 0,
    published: 0,
    uploaded: 0,
    failed: 0,
    wasShared: true,
    errors: [],
    outOfTime: false,
  }

  // Confirm the whole tree is still readable by the domain before adding to it.
  // Publishing into a folder nobody but the owner can open is indistinguishable
  // from success everywhere else in the system.
  try {
    const root = await ensureRootFolder()
    result.wasShared = await ensureDomainShared(root.id, PRIMARY_MAILBOX)
    if (!result.wasShared) {
      console.warn('[drive/reconcile] root folder was not shared with the domain; re-shared it')
    }
  } catch (err) {
    result.errors.push(
      `Could not verify domain sharing: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  for (const kind of Object.keys(SOURCES) as DriveRecordKind[]) {
    const ids = await pendingRecords(kind)
    result.records += ids.length

    for (const id of ids) {
      if (Date.now() > deadline) {
        result.outOfTime = true
        return result
      }

      try {
        const published = await publishRecordToDrive(kind, id)
        result.uploaded += published.uploaded
        result.failed += published.failed
        if (published.uploaded > 0) result.published++
        for (const err of published.errors) {
          if (result.errors.length < 10) result.errors.push(`${kind} ${id}: ${err}`)
        }
      } catch (err) {
        // A missing Drive scope fails identically for every remaining record,
        // so stopping is honest: continuing would produce one line per record
        // saying the same thing and bury the reason.
        if (err instanceof DriveScopeError) {
          result.errors.push(err.message)
          return result
        }
        result.failed++
        if (result.errors.length < 10) {
          result.errors.push(`${kind} ${id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  return result
}
