/**
 * Nightly import of every project's Drive folder, and the update it posts.
 *
 * Two folders can feed a project and they mean different things:
 *
 *   `deal_folder_id`         the folder the website deal form created, adopted
 *                            at promotion.
 *   `drive_source_folder_id` the team's OWN folder, linked by hand.
 *
 * The second is the one that matters in practice. The team files documents in a
 * shared drive organised by business line, and until it was linked the platform
 * read none of it — the deal-folder path had existed since September and no
 * project had ever had one, so this sync had never once had anything to do.
 *
 * Folders are linked rather than matched by name because the real names are
 * ambiguous: "Myton - Utah" has two candidate projects, so does "Stockton,
 * Utah", and West Wendover appears in two separate trees. A confident misfile is
 * worse than an unlinked folder, which at least announces itself.
 *
 * Every run that actually changes something posts ONE update to the project's
 * feed naming what arrived and what it is about — one per run, not one per file,
 * because linking a folder with thirty documents in it should read as a line in
 * the feed and not as a wall.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { importDriveFolder, type DocumentArrival } from './import'

export interface ProjectFolderSyncResult {
  projects: number
  folders: number
  added: number
  updated: number
  superseded: number
  failed: number
  errors: string[]
  outOfTime: boolean
}

interface ProjectRow {
  id: string
  name: string
  status: string | null
  deal_folder_id: string | null
  drive_source_folder_id: string | null
}

/** Finished work stops accumulating documents. */
const DONE = new Set(['closed', 'lost'])

/**
 * The update posted after a run that changed something.
 *
 * Written as prose rather than a table because it sits in the same feed as
 * correspondence and meeting notes, and the reader is skimming for what changed
 * rather than auditing a sync. The document's own AI summary is what answers
 * "what is it about" — the whole point of the line.
 */
export function composeArrivalUpdate(
  projectName: string,
  arrivals: DocumentArrival[],
  superseded: number
): { summary: string; body: string } {
  const added = arrivals.filter((a) => a.kind === 'added')
  const revised = arrivals.filter((a) => a.kind === 'revised')

  const parts: string[] = []
  if (added.length) parts.push(`${added.length} new document${added.length === 1 ? '' : 's'}`)
  if (revised.length) parts.push(`${revised.length} revised`)
  if (superseded) parts.push(`${superseded} archived`)
  const summary = `From Drive: ${parts.join(', ')}.`

  const lines = [`**${summary}**`, '']
  for (const group of [
    { label: 'Added', items: added },
    { label: 'Revised', items: revised },
  ]) {
    if (!group.items.length) continue
    lines.push(`### ${group.label}`, '')
    for (const a of group.items) {
      const where = a.path ? ` _(${a.path})_` : ''
      lines.push(`**${a.fileName}**${where}`)
      lines.push(a.summary?.trim() || '_No summary could be extracted from this file._')
      lines.push('')
    }
  }
  if (superseded) {
    lines.push(
      `### Archived`,
      '',
      `${superseded} document${superseded === 1 ? ' is' : 's are'} no longer in the Drive folder, so ${superseded === 1 ? 'it has' : 'they have'} been retired here: still on the record, no longer used to answer questions.`,
      ''
    )
  }
  lines.push(`_Imported automatically from the Drive folder linked to ${projectName}._`)

  return { summary, body: lines.join('\n') }
}

export async function postArrivalUpdate(
  projectId: string,
  projectName: string,
  arrivals: DocumentArrival[],
  superseded: number
): Promise<void> {
  if (arrivals.length === 0 && superseded === 0) return

  const supabase = createAdminClient()
  const { summary, body } = composeArrivalUpdate(projectName, arrivals, superseded)

  const { error } = await supabase.from('updates').insert({
    project_id: projectId,
    source: 'document',
    source_ref: 'drive-folder-sync',
    summary,
    raw_content: body,
    review_state: 'approved',
    // Deliberately not embedded. Every document named here is indexed in its own
    // right, and indexing the notice as well would put a second, thinner copy of
    // each summary in front of the retriever.
    embedding_status: 'skipped',
  })
  if (error) {
    // The documents are already imported and safe. A missing feed line is worth
    // a log, never a failed sync.
    console.error('[drive/project-folder-sync] could not post update:', error.message)
  }
}

export async function syncProjectFolders(
  opts: { budgetMs?: number } = {}
): Promise<ProjectFolderSyncResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60 * 1000)
  const supabase = createAdminClient()

  const result: ProjectFolderSyncResult = {
    projects: 0,
    folders: 0,
    added: 0,
    updated: 0,
    superseded: 0,
    failed: 0,
    errors: [],
    outOfTime: false,
  }

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, status, deal_folder_id, drive_source_folder_id')
    .or('deal_folder_id.not.is.null,drive_source_folder_id.not.is.null')
  if (error) throw new Error(`Could not load Drive folders: ${error.message}`)

  // Filtered here rather than in the query because `status <> 'closed'` is NULL
  // for a null status and would silently drop those rows — an unset status is
  // not a finished project.
  const rows = ((data ?? []) as ProjectRow[]).filter((r) => !DONE.has(r.status ?? ''))

  for (const row of rows) {
    // Both can be set and be the same folder once a web-form deal's folder is
    // also linked as its source; importing it twice would do no harm but wastes
    // a listing, so collapse them.
    const folders = [...new Set([row.drive_source_folder_id, row.deal_folder_id].filter(Boolean))]
    if (folders.length === 0) continue

    result.projects++
    const arrivals: DocumentArrival[] = []
    let superseded = 0

    for (const folderId of folders) {
      if (Date.now() >= deadline) {
        result.outOfTime = true
        break
      }
      result.folders++

      try {
        // Per-folder slice of what is left, so one large folder cannot consume
        // the whole budget and starve every project behind it.
        const imported = await importDriveFolder({
          folderId: folderId as string,
          projectId: row.id,
          budgetMs: Math.max(30_000, deadline - Date.now()),
        })
        result.added += imported.added
        result.updated += imported.updated
        result.superseded += imported.superseded
        superseded += imported.superseded
        arrivals.push(...imported.arrivals)
        if (imported.outOfTime) result.outOfTime = true
        if (imported.supersedeHeldBack) {
          result.errors.push(`${row.name}: ${imported.supersedeHeldBack}`)
        }
        if (imported.failed > 0) {
          result.errors.push(`${row.name}: ${imported.errors.slice(0, 2).join('; ')}`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[drive/project-folder-sync] ${row.name} failed:`, message)
        result.errors.push(`${row.name}: ${message.slice(0, 200)}`)
        result.failed++
      }
    }

    await postArrivalUpdate(row.id, row.name, arrivals, superseded)
    if (result.outOfTime) break
  }

  return result
}
