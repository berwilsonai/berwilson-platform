/**
 * Nightly re-sync of every promoted deal folder.
 *
 * A deal folder is not a snapshot — it keeps filling through diligence, which is
 * exactly why the team uses it. Without this, the project's Documents tab would
 * freeze at whatever existed on the day it was promoted, and Ber AI would answer
 * from a stale package while the real one moved on in Drive.
 *
 * Runs as a second phase of the existing drive-sync cron rather than a twelfth
 * launchd job: both phases talk to the same Drive credential and neither is
 * urgent enough to need its own clock.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { importDriveFolder } from './import'

export interface DealFolderSyncResult {
  projects: number
  added: number
  updated: number
  failed: number
  errors: string[]
  outOfTime: boolean
}

export async function syncDealFolders(
  opts: { budgetMs?: number } = {}
): Promise<DealFolderSyncResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60 * 1000)
  const supabase = createAdminClient()

  const result: DealFolderSyncResult = {
    projects: 0,
    added: 0,
    updated: 0,
    failed: 0,
    errors: [],
    outOfTime: false,
  }

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, status, deal_folder_id')
    .not('deal_folder_id', 'is', null)
  if (error) throw new Error(`Could not load deal folders: ${error.message}`)

  // Finished work stops accumulating documents, so re-listing it every night is
  // Drive calls spent on nothing. Filtered here rather than in the query because
  // `status <> 'closed'` is NULL for a null status and would silently drop those
  // rows — an unset status is not a finished project.
  const DONE = new Set(['closed', 'lost'])
  const rows = (
    (data ?? []) as { id: string; name: string; status: string | null; deal_folder_id: string | null }[]
  ).filter((r) => !DONE.has(r.status ?? ''))

  for (const row of rows) {
    if (Date.now() >= deadline) {
      result.outOfTime = true
      break
    }
    if (!row.deal_folder_id) continue

    result.projects++
    try {
      // Per-project slice of what is left, so one large folder cannot consume
      // the whole budget and starve every project behind it.
      const remaining = Math.max(30_000, deadline - Date.now())
      const imported = await importDriveFolder({
        folderId: row.deal_folder_id,
        projectId: row.id,
        budgetMs: remaining,
      })
      result.added += imported.added
      result.updated += imported.updated
      if (imported.failed > 0) {
        result.errors.push(`${row.name}: ${imported.errors.slice(0, 2).join('; ')}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[drive/deal-folder-sync] ${row.name} failed:`, message)
      result.errors.push(`${row.name}: ${message.slice(0, 200)}`)
      result.failed++
    }
  }

  return result
}
